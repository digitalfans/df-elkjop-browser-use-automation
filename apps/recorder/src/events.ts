// One line of a Ticket's timeline.
export type Target = {
  tag: string;
  role: string | null;
  name: string;
  label: string;
  placeholder: string;
  text: string;
  id: string;
  testId: string;
  locator: string;
};

export type EventType = 'start' | 'stop' | 'click' | 'change' | 'edit' | 'key' | 'copy' | 'cut' | 'paste'
  | 'navigate' | 'tab-open' | 'tab-close' | 'annotation';

export type Event = {
  seq: number; // global across all Recording Sessions of the Ticket
  session: number;
  step: number | null; // latest Step annotation's number
  t: number; // ms since this Recording Session started
  tab: number | null;
  url?: string;
  type: EventType;
  target?: Target;
  value?: string | boolean; // passwords masked
  text?: string; // copy/cut/paste text, or annotation text
  key?: string;
  kind?: 'step' | 'checkpoint' | 'observation';
  n?: number; // Step number, on step annotations
  screenshot?: string; // relative path
};
