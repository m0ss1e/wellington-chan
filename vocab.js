// vocab.js — Wellington-chan's language vocabulary
// All natural-language stuff lives here. Edit this file to teach her new
// phrasings, aliases, fillers, contractions, or time words. The classifier
// in index.html reads from window.VOCAB and never needs touching.

window.VOCAB = {

  // ─────────────────────────────────────────────────────────────────────
  // QUERY TEMPLATES
  // ─────────────────────────────────────────────────────────────────────
  // The classifier loops through `queries` top-to-bottom and returns the
  // first matching template. Order matters — put more specific patterns
  // (e.g. with deadlines) before more general ones.
  //
  // Each pattern is a JS regex with optional named groups:
  //   (?<place>...)     extracts the destination
  //   (?<deadline>\d+)  extracts a minute-count deadline
  //
  // To add a new phrasing: append a regex to the `patterns` array of the
  // matching profile. To add a new question type: add a new template object.

  queries: [

    // 1. Commuter with explicit deadline
    {
      profile: 'commuter',
      examples: [
        'Can I make it to Kelburn in 20 minutes?',
        'Will I get to Newtown in 10 min?',
        '20 min to Te Papa',
      ],
      patterns: [
        /(?:can|could|will|would) (?:i|we) (?:make it|make|get|reach|head over) to (?<place>.+?) in (?<deadline>\d+)\s*(?:min|minutes?|m)\b/,
        /(?:will|am|are) (?:i|we) (?:on time|able to get|able to make it) to (?<place>.+?) in (?<deadline>\d+)\s*(?:min|minutes?)/,
        /(?<deadline>\d+)\s*(?:min|minutes?|m) to (?<place>.+)$/,
        /(?:can|could) (?:i|we) (?:make it|get) to (?<place>.+?) in under (?<deadline>\d+)\s*(?:min|minutes?)/,
      ],
    },

    // 2. Wayfinder (bus, no specific deadline — defaults to 15 min)
    {
      profile: 'wayfinder',
      defaults: { deadline: 15 },
      examples: [
        'Can I catch a bus to Karori?',
        'Is there a bus to Lyall Bay soon?',
        'Should I take the bus to Newtown?',
      ],
      patterns: [
        /(?:can|could|will) (?:i|we) (?:catch|get|grab|take|hop on|jump on) (?:a |the )?bus to (?<place>.+?)(?:\s+(?:soon|now))?$/,
        /(?:is there|are there|any) (?:a |any )?bus(?:es)? to (?<place>.+?)(?:\s+(?:soon|now))?$/,
        /should (?:i|we) (?:take|get|catch) (?:a |the )?bus to (?<place>.+?)$/,
      ],
    },

    // 3. Pedestrian (walking-specific)
    {
      profile: 'pedestrian',
      examples: [
        'Can I walk to Te Papa?',
        'Is it walkable to Mt Vic?',
        'Should I walk to the museum?',
      ],
      patterns: [
        /(?:can|could|would|will|should) (?:i|we) (?:walk|stroll|hoof it|hike) to (?<place>.+?)(?:\s+in (?<deadline>\d+)\s*(?:min|minutes?))?$/,
        /(?:am|are) (?:i|we) able to walk to (?<place>.+?)$/,
        /is (?:it )?walkable to (?<place>.+?)$/,
        /can (?:i|we) get to (?<place>.+?) on foot$/,
      ],
    },

    // 4. Commuter without deadline (fallback)
    {
      profile: 'commuter',
      examples: ['Can I get to Kelburn?', 'Will I make it to Newtown?'],
      patterns: [
        /(?:can|could|will|would) (?:i|we) (?:make it|get|reach|head over) to (?<place>.+?)$/,
      ],
    },

    // 5. Holistic ("should I go to X?")
    {
      profile: 'holistic',
      examples: [
        'Should I go to Mt Vic?',
        'Worth heading to Te Papa?',
        'Is the museum worth it?',
      ],
      patterns: [
        /should (?:i|we) (?:go|head|head over|venture|wander|swing by) to (?<place>.+?)$/,
        /(?:is it )?worth (?:going|heading|venturing) to (?<place>.+?)$/,
        /is (?<place>.+?) worth (?:going to|the trip|it)$/,
        /(?:thinking|thought) (?:of|about) (?:going|heading) to (?<place>.+?)$/,
      ],
    },

    // 6a. Outdoors NEGATIVE polarity (score inverted before reaction).
    //     "Yes" answers correspond to BAD weather:
    //       "should I bring an umbrella?" → yes if rainy
    //       "is it raining?" → yes if rainy
    //     So heavy rain → Happy ("YES bring it!"), sunny → Distressed ("NO, no need!")
    //     LISTED FIRST so umbrella-style questions don't get caught by general patterns.
    {
      profile: 'outdoors',
      polarity: 'negative',
      examples: [
        'Should I bring an umbrella?',
        'Will it rain tomorrow?',
        'Is it gonna rain?',
        'Should I wear a jacket?',
        'Is it cold outside?',
      ],
      patterns: [
        /\bshould (?:i|we) (?:wear|need|bring|take|pack|grab) (?:a |an )?(?:jacket|coat|raincoat|umbrella|hat|sweater|jumper|scarf|gloves|beanie|hoodie)/,
        /\bdo (?:i|we) need (?:a |an )?(?:jacket|coat|umbrella|raincoat|hat|sweater|jumper|scarf|gloves|beanie|hoodie)/,
        /\bwill it (?:rain|be cold|be hot|be windy|be dark|be raining|be miserable|be wet|be stormy|be nasty|be freezing|be foggy|be cloudy|be gloomy|pour|chuck it down)/,
        /\bis it (?:gonna|going to) (?:rain|pour|be cold|be windy|be miserable|chuck it down)/,
        /\bis it (?:bad|cold|hot|raining|rainy|miserable|cloudy|wet|foggy|windy|gloomy|stuffy|chilly|freezing|stormy|nasty|pouring|grim|dreary)\b/,
        /\bis the weather (?:bad|cold|hot|raining|miserable|cloudy|wet|windy|gloomy|nasty|terrible|awful|grim|dreary)\b/,
        /\bis it (?:cold|hot|wet|windy|raining|rainy|miserable|stormy) (?:outside|out)\b/,
      ],
    },

    // 6b. Outdoors POSITIVE polarity (score → reaction directly).
    //     "Yes" answers correspond to GOOD weather:
    //       "is it nice?" → yes if pleasant
    //       "should I go outside?" → yes if pleasant
    //     Place can optionally be extracted from "in <place>" tail by the
    //     classifier — that fallback is hard-coded in classify().
    {
      profile: 'outdoors',
      polarity: 'positive',
      examples: [
        'Is it nice outside?',
        "What's the weather like?",
        'Should I go outside?',
        'Will it be nice tomorrow?',
      ],
      patterns: [
        /\bis it (?:nice|good|okay|ok|warm|sunny|clear|dry|crisp|pleasant|lovely|beautiful|gorgeous)\b/,
        /\bis the weather (?:nice|good|warm|sunny|clear|pleasant|okay|lovely|beautiful)\b/,
        /\b(?:what's|what is) (?:the |it )?(?:weather|like outside|outside|like today|like tomorrow|like out there)/,
        /\b(?:how's|how is) (?:the |it )?(?:weather|outside|out there|going outside)/,
        /\b(?:should|can|will|do) (?:i|we) (?:go outside|head out|step out|venture out)/,
        /\bwill it be (?:nice|sunny|warm|clear|good|pleasant|lovely|beautiful)/,
        /\bwill (?:i|we) have (?:enough )?daylight/,
        /\bis it (?:nice|warm|sunny|clear|pleasant|lovely) (?:outside|out)\b/,
      ],
    },
  ],

  // ─────────────────────────────────────────────────────────────────────
  // PLACE ALIASES
  // ─────────────────────────────────────────────────────────────────────
  // For aliases that resolve to a *suburb name* (which then looks up coords
  // via wellington_data.js's SUBURBS dict). Most aliases live in
  // landmarks_data.js (with explicit coords) — this dict is for cases where
  // the alias should resolve to a suburb centroid rather than a specific
  // landmark.

  placeAliases: {
    'mt vic':  'Mount Victoria',
    'town':    'Wellington Central',
    'the cbd': 'Wellington Central',
    'wgtn':    'Wellington Central',
    'welly':   'Te Aro',
  },

  // ─────────────────────────────────────────────────────────────────────
  // FILLER WORDS
  // ─────────────────────────────────────────────────────────────────────
  // Stripped from input during normalisation. So
  //   "Hey, can I just walk to Te Papa, please?"  becomes
  //   "can i walk to te papa"
  // before regex matching.

  fillers: [
    'hey', 'hi', 'hello',
    'um', 'uh', 'er', 'ah',
    'just', 'like', 'so', 'well', 'actually', 'kinda', 'sorta', 'really',
    'please', 'maybe', 'perhaps', 'mate', 'bro', 'dude', 'eh',
  ],

  // ─────────────────────────────────────────────────────────────────────
  // CONTRACTIONS
  // ─────────────────────────────────────────────────────────────────────
  // Expanded during normalisation. Note: 's contractions (what's, how's,
  // when's, where's) are NOT expanded — patterns handle them directly via
  // alternation, because expanding "what's" → "what is" can break patterns
  // and "what's" can sometimes be possessive rather than a contraction of
  // "is".

  contractions: {
    "it's":       'it is',
    "i'm":        'i am',
    "i'd":        'i would',
    "i'll":       'i will',
    "i've":       'i have',
    "we're":      'we are',
    "we'll":      'we will',
    "we'd":       'we would',
    "you're":     'you are',
    "they're":    'they are',
    "don't":      'do not',
    "doesn't":    'does not',
    "didn't":     'did not',
    "isn't":      'is not',
    "aren't":     'are not',
    "wasn't":     'was not',
    "weren't":    'were not',
    "won't":      'will not',
    "shouldn't":  'should not',
    "couldn't":   'could not',
    "wouldn't":   'would not',
  },

  // ─────────────────────────────────────────────────────────────────────
  // TIME WORDS
  // ─────────────────────────────────────────────────────────────────────
  // Replaced during normalisation — converts natural-language durations to
  // the "N min" form that Commuter / Pedestrian patterns extract.
  // Order matters: longer phrases first (insertion order is preserved by
  // modern JS for string-keyed objects), so "an hour and a half" matches
  // before "an hour".
  //
  // For dynamic "N hours" (e.g. "in 2 hours", "in 1.5 hours"), a regex in
  // normalize() handles those automatically — no need to enumerate every
  // possible number here.

  timeWords: {
    'an hour and a half':    '90 min',
    'a quarter of an hour':  '15 min',
    'quarter of an hour':    '15 min',
    'half an hour':          '30 min',
    'half hour':             '30 min',
    'quarter hour':          '15 min',
    'a couple of hours':     '120 min',
    'couple of hours':       '120 min',
    'a couple hours':        '120 min',
    'a few hours':           '180 min',
    'few hours':             '180 min',
    'half a day':            '720 min',
    'an hour':               '60 min',
    'one hour':              '60 min',
    'ten minutes':           '10 min',
    'fifteen minutes':       '15 min',
    'twenty minutes':        '20 min',
    'twenty-five minutes':   '25 min',
    'thirty minutes':        '30 min',
    'forty-five minutes':    '45 min',
    'forty five minutes':    '45 min',
    'sixty minutes':         '60 min',
    'ninety minutes':        '90 min',
  },

  // ─────────────────────────────────────────────────────────────────────
  // DATE QUALIFIERS
  // ─────────────────────────────────────────────────────────────────────
  // Static day-offsets matched against the input. "This weekend" and named
  // days (Monday-Sunday) are computed programmatically in extractDateInfo
  // because their offset depends on the current day of the week.

  dateQualifiers: {
    'today':    { offset: 0, label: 'today' },
    'tonight':  { offset: 0, label: 'tonight' },
    'tomorrow': { offset: 1, label: 'tomorrow' },
  },
};
