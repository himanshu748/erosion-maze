import { Router } from 'express';
import { reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { STRINGS } from '../../shared/strings';

export const internal = Router();

export async function createPracticePost(): Promise<UiResponse> {
  try {
    const post = await reddit.submitCustomPost({
      entry: 'default',
      title: STRINGS.gameName,
      textFallback: { text: STRINGS.practice.note },
    });
    return { navigateTo: `https://www.reddit.com/comments/${post.id.slice(3)}` };
  } catch (error) {
    console.warn('Practice post creation failed:', error);
    return { showToast: STRINGS.practice.postError };
  }
}

internal.post('/menu/practice', async (_req, res) => {
  res.json(await createPracticePost());
});
