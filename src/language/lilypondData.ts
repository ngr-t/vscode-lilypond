export type LilypondKeyword = {
  label: string;
  detail: string;
  documentation: string;
};

export const LILYPOND_KEYWORDS: LilypondKeyword[] = [
  { label: "\\version", detail: "Version declaration", documentation: "Declare LilyPond version, e.g. `\\version \"2.24.4\"`." },
  { label: "\\relative", detail: "Relative pitch mode", documentation: "Interpret following note pitches relative to a starting pitch." },
  { label: "\\score", detail: "Score block", documentation: "Top-level block for printable/playable score content." },
  { label: "\\new", detail: "Create context", documentation: "Create a new context such as Staff, Voice, Lyrics, PianoStaff." },
  { label: "\\layout", detail: "Layout block", documentation: "Configure engraving/layout options for a score." },
  { label: "\\midi", detail: "MIDI block", documentation: "Configure MIDI output options for playback/export." },
  { label: "\\paper", detail: "Paper block", documentation: "Configure page size, margins, and paper output options." },
  { label: "\\header", detail: "Header block", documentation: "Set title/composer/tagline and metadata fields." },
  { label: "\\tempo", detail: "Tempo mark", documentation: "Set tempo, e.g. `\\tempo 4 = 96`." },
  { label: "\\time", detail: "Time signature", documentation: "Set time signature, e.g. `\\time 4/4`." },
  { label: "\\key", detail: "Key signature", documentation: "Set key and mode, e.g. `\\key c \\major`." },
  { label: "\\clef", detail: "Clef", documentation: "Set clef, e.g. `\\clef treble`, `\\clef bass`." },
  { label: "\\include", detail: "Include file", documentation: "Include another LilyPond file, e.g. `\\include \"common.ily\"`." },
  { label: "\\repeat", detail: "Repeat command", documentation: "Create repeated music sections, e.g. `\\repeat volta 2 { ... }`." },
  { label: "\\transpose", detail: "Transpose block", documentation: "Transpose music from one pitch to another." },
  { label: "\\chordmode", detail: "Chord mode", documentation: "Enter chords using chord notation syntax." },
  { label: "\\lyricmode", detail: "Lyric mode", documentation: "Enter lyric syllables and extenders for vocal lines." },
  { label: "\\addlyrics", detail: "Attach lyrics", documentation: "Attach lyric text to previous voice/music expression." },
  { label: "\\tuplet", detail: "Tuplet", documentation: "Create tuplets, e.g. `\\tuplet 3/2 { c8 d e }`." },
  { label: "\\partial", detail: "Pickup/anacrusis", documentation: "Set pickup duration at the beginning of piece." }
];

export const KEYWORD_BY_LABEL = new Map(LILYPOND_KEYWORDS.map((item) => [item.label, item]));
