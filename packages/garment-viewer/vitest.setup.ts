/**
 * Lets the event loop turn between tests.
 *
 * Why: these tests are CPU-bound and synchronous (cloth, fitting, bundle building), and vitest goes from one test to
 * the next on promises alone. A file whose tests run back to back for more than 60 s never lets its worker read the
 * main process's answer to the progress message it sent ("onTaskUpdate"); vitest's worker RPC gives up after 60 s
 * (fixed in vitest 3, no setting), and the run ends with every test passing, "Timeout calling onTaskUpdate" and exit 1.
 * It showed up on a busy machine because the same tests then take two or three times as long. Reproduced on an idle
 * one with four 20 s busy loops in one file: exit 1 without this file, exit 0 with it.
 *
 * What: before and after a test, when more than 250 ms have passed since the loop last turned, wait 10 ms. In that time
 * the pending progress message is sent and its answer read. A single test (or hook) that itself blocks for 60 s can
 * still trip it; the 60 s test time-out reports that one by name.
 */
import { afterEach, beforeEach } from 'vitest';

let turned = performance.now();
async function turn(): Promise<void> {
  if (performance.now() - turned < 250) return;
  await new Promise((resolve) => setTimeout(resolve, 10));
  turned = performance.now();
}
beforeEach(turn);
afterEach(turn);
