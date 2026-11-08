import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/** Reusable prompt templates clients can surface as slash-commands. */
export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    'recommend_audiobooks',
    {
      title: 'Recommend audiobooks',
      description: 'Recommend books I do not own yet, based on my Audiobookshelf listening history.',
      argsSchema: {
        count: z.string().optional().describe('How many suggestions (default 5)'),
        mood: z.string().optional().describe('Optional steer, e.g. "something lighter", "standalone sci-fi"'),
      },
    },
    ({ count, mood }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Recommend ${count || '5'} audiobooks for me${mood ? ` (${mood})` : ''}.`,
              '1. Call abs_get_taste_profile to understand what I like (weight finished books most; treat stalled books as a weak negative).',
              '2. Draft roughly twice as many candidates as needed: continuations of my series first (next entries I do not own), then new books by favourite authors, then similar authors/series in my top genres and narrators.',
              '3. Call abs_check_owned on the candidates and drop anything I already own.',
              '4. Present the final list: title, author, series and number if any, one line on why it fits my history, and a confidence note if you are unsure the book exists in audio.',
              '5. Do not start any downloads; ask me which ones I want.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'continue_my_series',
    {
      title: 'Continue my series',
      description: 'Find series I have started and what to listen to (or get) next in each.',
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'Look at the series I have been listening to (abs_get_taste_profile with include_series_status).',
              'For each, tell me: books finished, the next book I already own (if any), and the next book in the series I do not own yet (use your own knowledge of the series, then confirm with abs_check_owned).',
              'Order by how engaged I am with the series. Skip series I have finished completely unless new books exist.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
