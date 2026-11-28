import { Router } from 'express';
import { reddit, redis } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { STRINGS } from '../../shared/strings';
import { runDaily, type DailyDeps } from '../core/daily';

export const internal = Router();

export async function createPracticePost(): Promise<UiResponse> {
  try {
    const post = await reddit.submitCustomPost({
      entry: 'default',
      title: STRINGS.gameName,
      textFallback: { text: STRINGS.practice.note },
    });
    return {
      navigateTo: `https://www.reddit.com/comments/${post.id.slice(3)}`,
    };
  } catch (error) {
    console.warn('Practice post creation failed:', error);
    return { showToast: STRINGS.practice.postError };
  }
}

internal.post('/menu/practice', async (_req, res) => {
  res.json(await createPracticePost());
});

export const publishDailyPost: DailyDeps['publish'] = async (
  title,
  postData
) => {
  const entry = 'default';
  // SDK 0.15.4 reads this same runtime config before dispatch. Once dispatched,
  // even a thrown error can follow successful creation and a failed post lookup.
  if (!globalThis.devvit?.appConfig?.post?.entrypoints[entry]) {
    console.warn('Daily maze cannot publish without its configured post entry');
    return 'not-submitted';
  }
  const post = await reddit.submitCustomPost({
    entry,
    title,
    postData: { ...postData },
    textFallback: { text: STRINGS.gameName },
  });
  return post.id;
};

internal.post('/scheduler/daily', async (_req, res) => {
  const result = await runDaily({
    redis,
    publish: publishDailyPost,
    updatePostData: (id, postData) => reddit.setPostData(id, { ...postData }),
  });
  res.json(result);
});
