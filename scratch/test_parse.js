import testRunnerAgent from '../src/agents/TestRunnerAgent.js';

const stdoutPassed = `
Running 1 test using 1 worker
[1/1] tests\\Performance_Testing\\msn\\homepage\\perf-001-msn-homepage-startup-performance-and-load-time.spec.js:3:1 › Navigation scenario on MSN with performance measurement
  \u001b[32m1 passed\u001b[0m\u001b[90m (15.4s)\u001b[0m
`;

const stdoutFailed = `
Running 1 test using 1 worker
[1/1] tests\\smoke_Testing\\msn\\homepage\\smk-001-msn-homepage-load-verification.spec.js:3:1 › MSN homepage navigation and screenshot
  \u001b[31m1 failed\u001b[0m
`;

console.log("Passed stats:", testRunnerAgent.parsePlaywrightSummary(stdoutPassed, ''));
console.log("Failed stats:", testRunnerAgent.parsePlaywrightSummary(stdoutFailed, ''));
