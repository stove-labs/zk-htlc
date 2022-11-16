import { isReady, UInt64 } from 'snarkyjs';

await isReady;

export const oneDay = UInt64.from(86400000);
// TODO: test helpers
// TODO: do days need to be UInt64 or is number sufficient circuit-wise?
export const addDays = (timestamp: UInt64, days: number): UInt64 => {
  return Array(days)
    .fill(null)
    .reduce((timestamp) => {
      return timestamp.add(oneDay);
    }, timestamp);
};

export const subDays = (timestamp: UInt64, days: number): UInt64 => {
  return Array(days)
    .fill(null)
    .reduce((timestamp) => {
      return timestamp.sub(oneDay);
    }, timestamp);
};

export const assertNotZero = (amount: UInt64) => {
  amount.assertGt(UInt64.from(0));
};
