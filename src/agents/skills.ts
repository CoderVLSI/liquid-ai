import type { Tool } from './types.ts';

/**
 * A skill is a playbook for one kind of request. A 2B model does far better when it sees a handful of tools and
 * numbered steps with a worked example than when it sees every tool and a general instruction. So the app (not the
 * model) picks the skill from the user's words, offers only that skill's tools, and puts its playbook in the prompt.
 */
export interface Skill {
  id: string;
  name: string;
  /** the request looks like this skill when this matches the task text */
  match: RegExp;
  /** tool names this skill may use ('*' = everything) */
  tools: string[];
  /** tool-name prefix that must exist (a connection); otherwise the skill tells the user to connect it */
  needs?: string;
  /** when this matches, no other skill is mixed in */
  exclusive?: boolean;
  /** may hand sub-tasks to teammates */
  delegate?: boolean;
  steps: string[];
  examples: { user: string; call: string }[];
}

const DAY = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun';

export const SKILLS: Skill[] = [
  {
    id: 'reminders',
    name: 'Reminders and deadlines',
    match: new RegExp(
      '\\b(remind|reminder|reminders|notify me|alert me|ping me|wake me|alarm|don\'?t (let me )?forget|deadline|due)\\b|' +
        `\\b(by|before|until)\\s+(\\d{1,2}(:\\d{2})?\\s*(am|pm)?|tomorrow|tonight|today|noon|midnight|${DAY})\\b`,
      'i',
    ),
    exclusive: true,
    tools: ['set_reminder', 'list_reminders', 'cancel_reminder', 'parse_time', 'get_time'],
    steps: [
      'Decide WHAT to be reminded about: a short imperative phrase, e.g. "Submit the BITS assignment".',
      'Decide WHEN, using the user\'s own words. Do not work out dates yourself: put the words in "when" exactly as the user said them ("in 20 minutes", "today 11:30", "tomorrow 9am", "friday 6pm", "12").',
      'Call set_reminder with "text" and "when".',
      'If the user states a task with a DEADLINE ("submit it by 12", "due tomorrow 5pm") and does not name a reminder time, put the deadline in "when" and set "minutes_before" to 30.',
      'If there is no time anywhere in the request, call ask_user with the question "When should I remind you?".',
      '"What reminders do I have?" -> call list_reminders. "Cancel the X reminder" -> call list_reminders, then cancel_reminder with the id.',
      'When set_reminder answers "Reminder set", reply with one short sentence saying what and when. Do not search the web. Do not call other tools.',
    ],
    examples: [
      { user: 'Remind me at 11:30 to submit the BITS assignment', call: 'set_reminder {"text": "Submit the BITS assignment", "when": "11:30"}' },
      { user: 'Submit the assignment by 12', call: 'set_reminder {"text": "Submit the assignment", "when": "12", "minutes_before": 30}' },
      { user: 'Remind me to call mom in 2 hours', call: 'set_reminder {"text": "Call mom", "when": "in 2 hours"}' },
    ],
  },
  {
    id: 'todos',
    name: 'To-do list',
    match: /\b(to-?do|todos|task list|checklist|my list|tick off|check off|mark .{1,40} (as )?(done|complete|completed|finished))\b/i,
    tools: ['add_todo', 'list_todos', 'complete_todo'],
    steps: [
      'To add something: call add_todo with a short "text".',
      'To show the list: call list_todos.',
      'To tick something off: call complete_todo with "item" set to a few words from the item (or its id).',
      'Then reply with one short sentence.',
    ],
    examples: [
      { user: 'Add buy milk to my to-do list', call: 'add_todo {"text": "Buy milk"}' },
      { user: 'Mark buy milk as done', call: 'complete_todo {"item": "buy milk"}' },
    ],
  },
  {
    id: 'notes',
    name: 'Notes',
    match: /\b(notes?|notebook|write down|jot down|make a note|save (this|that|it)|remember (that|this))\b/i,
    tools: ['save_note', 'list_notes', 'delete_note'],
    steps: [
      'To save something: call save_note with the full text to keep, in the user\'s words.',
      'To find notes: call list_notes, with "query" set to one word to search for (or no query for everything).',
      'To remove a note: call list_notes, then delete_note with its id.',
      'Then reply with one short sentence. For a question about notes, answer from what list_notes returned.',
    ],
    examples: [
      { user: 'Note that the wifi password is lotus42', call: 'save_note {"text": "The wifi password is lotus42"}' },
      { user: 'What did I note about wifi?', call: 'list_notes {"query": "wifi"}' },
    ],
  },
  {
    id: 'weather',
    name: 'Weather',
    match: /\b(weather|forecast|temperature outside|will it rain|umbrella|how (hot|cold) is it)\b/i,
    tools: ['weather'],
    steps: [
      'Call weather with "place" set to the city the user named. If they named none, call ask_user "Which city?".',
      'Answer in one or two sentences: the temperature, the sky, and rain if it is likely. Use only what the tool returned.',
    ],
    examples: [{ user: 'What is the weather in Pilani tomorrow?', call: 'weather {"place": "Pilani"}' }],
  },
  {
    id: 'math',
    name: 'Math and conversions',
    match: /\d\s*[-+*/^%x×÷]\s*\d|\d\s*%|\b\d+(\.\d+)? ?(of|times|plus|minus|divided by|multiplied by) \d|\b(calculate|calculator|how much is|percent|percentage|square root|sqrt|convert|how many (km|kilometers|miles|meters|feet|inches|kg|pounds|grams|litres|liters|minutes|hours))\b|\bto (km|miles?|meters?|metres?|feet|inches|kg|lbs?|pounds|grams|celsius|fahrenheit|litres?|liters?|mph|km\/h)\b/i,
    tools: ['calculator', 'convert_units'],
    steps: [
      'Never do arithmetic in your head. For sums, percentages and anything with numbers, call calculator with the expression, e.g. "18 / 100 * 2500".',
      'For units (miles, kg, celsius...), call convert_units with value, from and to.',
      'Then give the answer in one sentence, using the tool\'s number exactly.',
    ],
    examples: [
      { user: 'What is 18% of 2500?', call: 'calculator {"expression": "18 / 100 * 2500"}' },
      { user: 'Convert 5 miles to km', call: 'convert_units {"value": 5, "from": "miles", "to": "km"}' },
    ],
  },
  {
    id: 'time',
    name: 'Date and time',
    match: /\b(what('s| is) the (time|date|day)|what day|today'?s date|how many days|days (until|left|to)|how long (until|till)|countdown|weekday)\b/i,
    tools: ['get_time', 'parse_time', 'calculator'],
    steps: [
      'The current time is in the first lines of this prompt, but call get_time if you need to be sure.',
      'To find how far away a date is, call parse_time with "when" set to the date in words ("friday", "2026-12-25", "tomorrow 5pm"); it reports the distance.',
      'Answer in one sentence.',
    ],
    examples: [{ user: 'How many days until 2026-12-25?', call: 'parse_time {"when": "2026-12-25"}' }],
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    match: /\b(calendar|my schedule|meetings?|appointments?|events?|am i free|free (on|at|tomorrow)|book a|schedule a)\b/i,
    needs: 'calendar_',
    tools: ['calendar_list_events', 'calendar_create_event', 'parse_time', 'get_time'],
    steps: [
      'To see what is coming up: call calendar_list_events with "days" (7 by default).',
      'To add an event: first call parse_time with the start time in words, then call calendar_create_event with "title" and "start" copied from parse_time\'s "ISO" value. The user is asked to approve it.',
      'Report what you found or created in one or two sentences.',
    ],
    examples: [
      { user: 'What is on my calendar this week?', call: 'calendar_list_events {"days": 7}' },
      { user: 'Add dentist tomorrow 3pm', call: 'parse_time {"when": "tomorrow 3pm"}  then  calendar_create_event {"title": "Dentist", "start": "2026-10-30T15:00"}' },
    ],
  },
  {
    id: 'email',
    name: 'Gmail',
    match: /\b(e-?mails?|gmail|inbox|unread|mail from|send .{1,60} to \S+@)\b/i,
    needs: 'gmail_',
    tools: ['gmail_search', 'gmail_read', 'gmail_send'],
    steps: [
      'To find mail: call gmail_search with a Gmail query ("is:unread", "from:ann", "subject:invoice newer_than:7d").',
      'To read one: call gmail_read with an id from gmail_search.',
      'To send: call gmail_send with to, subject and body. The user is asked to approve it. Never send mail the user did not ask for.',
      'Summarise in a few short lines, using only what the tools returned.',
    ],
    examples: [
      { user: 'Any unread emails from Ann?', call: 'gmail_search {"query": "is:unread from:ann"}' },
      { user: 'Email bob@x.com that I am late', call: 'gmail_send {"to": "bob@x.com", "subject": "Running late", "body": "Hi Bob, I am running late."}' },
    ],
  },
  {
    id: 'drive',
    name: 'Google Drive',
    match: /\b(google drive|drive|google docs?|spreadsheet|my files?|my documents?)\b/i,
    needs: 'drive_',
    tools: ['drive_search', 'drive_read'],
    steps: [
      'Call drive_search with a few keywords.',
      'To look inside a file, call drive_read with an id from the search.',
      'Answer from what you read, in a few short lines.',
    ],
    examples: [{ user: 'Find my budget spreadsheet', call: 'drive_search {"query": "budget"}' }],
  },
  {
    id: 'slack',
    name: 'Slack',
    match: /\b(slack|channel)\b/i,
    needs: 'slack_',
    tools: ['slack_list_channels', 'slack_read_channel', 'slack_post_message'],
    steps: [
      'To see channels: call slack_list_channels.',
      'To read: call slack_read_channel with the channel name.',
      'To post: call slack_post_message with channel and text. The user is asked to approve it.',
      'Summarise briefly, using only what the tools returned.',
    ],
    examples: [{ user: 'What is new in #general?', call: 'slack_read_channel {"channel": "general"}' }],
  },
  {
    id: 'research',
    name: 'Looking things up',
    match: /\b(search|look ?up|find out|google|news|latest|who (is|was)|what (is|are|was|were) (a|an|the)\b|define|wikipedia|price of|tell me about|explain|how (do|does|to)|when (did|was)|where is|why (is|does|do))\b/i,
    tools: ['wikipedia', 'web_search', 'fetch_url'],
    steps: [
      'For facts about a person, place, thing or idea, call wikipedia with "topic" first.',
      'For news, prices or anything recent, call web_search with a short plain query (no quote marks).',
      'To read a page from the results, call fetch_url with its address. Make at most three lookups in total.',
      'Answer in a few short sentences using only what the tools returned, and name the source. If nothing useful came back, say so plainly.',
      'Never search for the user\'s own tasks, plans or deadlines: they cannot be found online.',
    ],
    examples: [
      { user: 'Who is Ada Lovelace?', call: 'wikipedia {"topic": "Ada Lovelace"}' },
      { user: 'Latest news about ISRO', call: 'web_search {"query": "ISRO latest news"}' },
    ],
  },
];

export const GENERAL: Skill = {
  id: 'general',
  name: 'General help',
  match: /$^/,
  tools: ['*'],
  delegate: true,
  steps: [
    'Work out what the user wants and choose the single tool that does it. If no tool fits, just answer.',
    'Reminders -> set_reminder. Notes -> save_note. To-dos -> add_todo. Sums -> calculator. Weather -> weather. Facts -> wikipedia.',
    'Use web_search only for outside facts, never for the user\'s own tasks or deadlines. Make at most three lookups.',
    'Finish with one or two short sentences.',
  ],
  examples: [],
};

const MAX_SKILLS = 2;

/** Picks the playbook(s) for a task. A skill whose connection is missing stays in, but tells the user to connect it. */
export function pickSkills(goal: string, toolNames: string[]): Skill[] {
  const hits = SKILLS.filter((s) => s.match.test(goal));
  const chosen = (hits.find((s) => s.exclusive) ? [hits.find((s) => s.exclusive)!] : hits).slice(0, MAX_SKILLS);
  if (!chosen.length) return [GENERAL];
  return chosen.map((s) => {
    if (s.needs && !toolNames.some((n) => n.startsWith(s.needs!))) {
      return {
        ...s,
        tools: [],
        steps: [`${s.name} is not connected. Do not call any tool. Reply: "Connect ${s.name} first: open Tools & connections, then try again."`],
        examples: [],
      };
    }
    return s;
  });
}

/** The tools those skills may use. */
export function allowedTools(skills: Skill[], tools: Tool[]): Tool[] {
  if (skills.some((s) => s.tools.includes('*'))) return tools;
  const names = new Set(skills.flatMap((s) => s.tools));
  return tools.filter((t) => names.has(t.name));
}

/** The playbook text that goes in the system prompt. */
export function skillPrompt(skills: Skill[]): string {
  const out: string[] = [];
  for (const s of skills) {
    out.push(`SKILL: ${s.name}`);
    s.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
    if (s.examples.length) {
      out.push('Examples:');
      for (const e of s.examples) out.push(`User: ${e.user}\nYou: ${e.call}`);
    }
  }
  return out.join('\n');
}
