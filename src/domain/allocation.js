/** @import { Area, AreaId, DayId, FixedEntry, FixedEvent, SlotEntry, SlotKey } from './types.js' */
import { DAY_IDS, REVIEW_SLOT_KEY, SLOT_KEYS, parseSlotKey, slotKey } from './calendar.js';

/**
 * @param {readonly FixedEvent[]} recurring
 * @returns {Partial<Record<SlotKey, FixedEntry>>}
 */
export function fixedEntriesFrom(recurring) {
  /** @type {Partial<Record<SlotKey, FixedEntry>>} */
  const fixed = {};
  for (const event of recurring) {
    fixed[slotKey(event.dayId, event.slotId)] = { kind: 'fixed', label: event.label, areaId: event.areaId };
  }
  return fixed;
}

/**
 * Builds a full week: the review slot, the given fixed entries, and a
 * session in every other slot. Fixed entries linked to an area count
 * towards that area's target.
 *
 * @param {readonly Area[]} areas in priority order
 * @param {Partial<Record<SlotKey, FixedEntry>>} fixed
 * @returns {Record<SlotKey, SlotEntry>}
 */
export function generateWeek(areas, fixed) {
  /** @type {Partial<Record<SlotKey, SlotEntry>>} */
  const slots = { [REVIEW_SLOT_KEY]: { kind: 'review' } };
  for (const key of SLOT_KEYS) {
    const entry = fixed[key];
    if (entry && key !== REVIEW_SLOT_KEY) slots[key] = entry;
  }

  const freeKeys = SLOT_KEYS.filter((key) => slots[key] === undefined);
  const quotas = quotasFor(areas, creditedSessions(slots), freeKeys.length);
  for (const [key, areaId] of placeSessions(areas, quotas, freeKeys)) {
    slots[key] = { kind: 'session', areaId, taskId: null };
  }
  return /** @type {Record<SlotKey, SlotEntry>} */ (slots);
}

/**
 * @param {Partial<Record<SlotKey, SlotEntry>>} slots
 * @returns {Map<AreaId, number>}
 */
function creditedSessions(slots) {
  /** @type {Map<AreaId, number>} */
  const credited = new Map();
  for (const entry of Object.values(slots)) {
    if (entry.kind === 'fixed' && entry.areaId !== null) {
      credited.set(entry.areaId, (credited.get(entry.areaId) ?? 0) + 1);
    }
  }
  return credited;
}

/**
 * Sessions to place per area so the total equals the free capacity.
 * Spare capacity goes to the buffer. A shortfall cuts the buffer first,
 * then scales the other areas by largest remainder, earlier areas winning
 * ties.
 *
 * @param {readonly Area[]} areas
 * @param {Map<AreaId, number>} credited
 * @param {number} capacity
 * @returns {Map<AreaId, number>}
 */
function quotasFor(areas, credited, capacity) {
  const needs = new Map(areas.map((area) => [area.id, Math.max(0, area.target - (credited.get(area.id) ?? 0))]));
  const otherNeed = sum(needs.values()) - (needs.get('buffer') ?? 0);

  if (otherNeed <= capacity) {
    needs.set('buffer', capacity - otherNeed);
    return needs;
  }

  const scaled = areas
    .filter((area) => area.id !== 'buffer')
    .map((area, priority) => {
      const exact = ((needs.get(area.id) ?? 0) * capacity) / otherNeed;
      return { id: area.id, priority, quota: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
  const leftover = capacity - sum(scaled.map((item) => item.quota));
  const byRemainder = [...scaled].sort((a, b) => b.fraction - a.fraction || a.priority - b.priority);
  for (const item of byRemainder.slice(0, leftover)) item.quota += 1;

  return new Map([...scaled.map((item) => /** @type {[AreaId, number]} */ ([item.id, item.quota])), ['buffer', 0]]);
}

/**
 * Spreads each area evenly across the days, then orders each day by area
 * priority so the highest-priority work takes the morning.
 *
 * @param {readonly Area[]} areas
 * @param {Map<AreaId, number>} quotas
 * @param {readonly SlotKey[]} freeKeys
 * @returns {[SlotKey, AreaId][]}
 */
function placeSessions(areas, quotas, freeKeys) {
  const freeByDay = new Map(DAY_IDS.map((dayId) => [dayId, freeKeys.filter((key) => parseSlotKey(key).dayId === dayId)]));
  /** @type {Map<DayId, AreaId[]>} */
  const assigned = new Map(DAY_IDS.map((dayId) => [dayId, []]));

  for (const area of areas) {
    for (let unit = 0; unit < (quotas.get(area.id) ?? 0); unit += 1) {
      const day = bestDayFor(area.id, freeByDay, assigned);
      assigned.get(day)?.push(area.id);
    }
  }

  const priority = new Map(areas.map((area, index) => [area.id, index]));
  return DAY_IDS.flatMap((dayId) => {
    const dayAreas = [...(assigned.get(dayId) ?? [])].sort((a, b) => (priority.get(a) ?? 0) - (priority.get(b) ?? 0));
    const keys = freeByDay.get(dayId) ?? [];
    return dayAreas.map((areaId, index) => /** @type {[SlotKey, AreaId]} */ ([/** @type {SlotKey} */ (keys[index]), areaId]));
  });
}

/**
 * The day with the fewest sessions of this area so far, then the most room
 * left, then the earliest.
 *
 * @param {AreaId} areaId
 * @param {Map<DayId, SlotKey[]>} freeByDay
 * @param {Map<DayId, AreaId[]>} assigned
 * @returns {DayId}
 */
function bestDayFor(areaId, freeByDay, assigned) {
  /** @type {{ dayId: DayId, sameArea: number, room: number } | null} */
  let best = null;
  for (const dayId of DAY_IDS) {
    const dayAreas = assigned.get(dayId) ?? [];
    const room = (freeByDay.get(dayId)?.length ?? 0) - dayAreas.length;
    if (room <= 0) continue;
    const sameArea = dayAreas.filter((id) => id === areaId).length;
    if (best === null || sameArea < best.sameArea || (sameArea === best.sameArea && room > best.room)) {
      best = { dayId, sameArea, room };
    }
  }
  // Quotas never exceed the free slots, so a day with room always exists.
  if (best === null) throw new Error(`no free slot left for area ${areaId}`);
  return best.dayId;
}

/**
 * @param {Iterable<number>} values
 * @returns {number}
 */
function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
