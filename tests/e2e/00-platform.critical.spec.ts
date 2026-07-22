/**
 * Platform pin: the suite must KNOW which YouTrack it verified. Asserts the
 * instance version is within the app's supported range (>= manifest's
 * minYouTrackVersion) and records the exact version in the report/attachments,
 * so "tested on YouTrack X" is a checked fact, not a README claim. Runs first (00-).
 */
import { readFileSync } from 'node:fs';
import { expect, hasInstance, test } from './fixtures/test';

test.skip(!hasInstance, 'requires a real YouTrack instance (YT_TEST_BASE_URL)');

/** "2026.2.17765" → [2026, 2]; tolerates missing segments. */
function majorMinor(v: string): [number, number] {
  const m = v.match(/^(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

test('the instance version is supported and recorded', async ({ managerPage }, testInfo) => {
  const res = await managerPage.request.get('/api/config?fields=version,build');
  expect(res.ok()).toBeTruthy();
  const { version, build } = (await res.json()) as { version: string; build?: string };
  expect(version, 'the instance must report a version').toMatch(/^\d{4}\.\d/);

  const manifest = JSON.parse(readFileSync('manifest.json', 'utf8')) as {
    minYouTrackVersion: string;
  };
  const [minMajor, minMinor] = majorMinor(manifest.minYouTrackVersion);
  const [major, minor] = majorMinor(version);
  expect(
    major > minMajor || (major === minMajor && minor >= minMinor),
    `YouTrack ${version} must satisfy manifest minYouTrackVersion ${manifest.minYouTrackVersion}`,
  ).toBeTruthy();

  // Pin the verified version into the report artifacts.
  await testInfo.attach('youtrack-version.txt', {
    body: `YouTrack ${version}${build ? ` (build ${build})` : ''}`,
    contentType: 'text/plain',
  });
  console.warn(`[platform] verified against YouTrack ${version}${build ? ` build ${build}` : ''}`);
});
