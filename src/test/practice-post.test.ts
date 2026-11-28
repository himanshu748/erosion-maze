import { createDevvitTest } from '@devvit/test/server/vitest';
import { reddit } from '@devvit/web/server';
import { afterEach, expect, vi } from 'vitest';
import { createPracticePost } from '../server/routes/internal';
import { STRINGS } from '../shared/strings';

const test = createDevvitTest();
afterEach(() => vi.restoreAllMocks());

test('moderator practice action opens the post on the existing launcher', async () => {
  const published = { id: 't3_practice' } as unknown as Awaited<ReturnType<typeof reddit.submitCustomPost>>;
  const submit = vi.spyOn(reddit, 'submitCustomPost').mockResolvedValue(published);

  expect(await createPracticePost()).toEqual({ navigateTo: 'https://www.reddit.com/comments/practice' });
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    entry: 'default',
    title: STRINGS.gameName,
    textFallback: { text: STRINGS.practice.note },
  });
});

test('a failed practice post returns a useful menu response', async () => {
  const submit = vi.spyOn(reddit, 'submitCustomPost').mockRejectedValue(new Error('test failure'));
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  expect(await createPracticePost()).toEqual({ showToast: STRINGS.practice.postError });
  expect(submit).toHaveBeenCalledOnce();
});
