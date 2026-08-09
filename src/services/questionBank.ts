/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SelectedTestSnapshot,
  SelectedTestPart1Group,
  SelectedTestPart2Card,
  SelectedTestPart3Question
} from '../types.js';

// Deterministic pseudo-random number generator using Mulberry32
export function getSeededRandom(seed: string): () => number {
  // Simple FN-1a hash to convert string seed to a 32-bit integer
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  
  // Mulberry32 generator
  return function() {
    let t = (h += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1. Part 1 Topics (8 topic groups, each with 6 original questions)
export const PART_1_TOPICS = [
  {
    id: 'p1-hometown',
    title: 'Hometown & Neighborhood',
    questions: [
      { id: 'p1-hometown-1', text: 'Where is your hometown located?' },
      { id: 'p1-hometown-2', text: 'What is the most interesting part of your hometown?' },
      { id: 'p1-hometown-3', text: 'Do you prefer living in a big city or a small town?' },
      { id: 'p1-hometown-4', text: 'How long have you lived in your current neighborhood?' },
      { id: 'p1-hometown-5', text: 'What changes would you like to see in your hometown in the future?' },
      { id: 'p1-hometown-6', text: 'Would you recommend tourists visit your hometown?' }
    ]
  },
  {
    id: 'p1-dailyroutine',
    title: 'Daily Routines & Structure',
    questions: [
      { id: 'p1-dailyroutine-1', text: 'What is your typical morning routine?' },
      { id: 'p1-dailyroutine-2', text: 'Do you consider yourself an early bird or a night owl?' },
      { id: 'p1-dailyroutine-3', text: 'How do you usually balance your work or study with free time?' },
      { id: 'p1-dailyroutine-4', text: 'Is your weekend routine different from your weekday routine?' },
      { id: 'p1-dailyroutine-5', text: 'What is your favorite time of the day and why?' },
      { id: 'p1-dailyroutine-6', text: 'How do you manage your tasks when you have a busy schedule?' }
    ]
  },
  {
    id: 'p1-books',
    title: 'Reading & Book Preferences',
    questions: [
      { id: 'p1-books-1', text: 'Do you enjoy reading books in your spare time?' },
      { id: 'p1-books-2', text: 'What was your favorite book when you were a child?' },
      { id: 'p1-books-3', text: 'Do you prefer physical books, e-books, or audiobooks?' },
      { id: 'p1-books-4', text: 'How often do you read newspapers or magazines?' },
      { id: 'p1-books-5', text: 'What genre of books do you find most interesting?' },
      { id: 'p1-books-6', text: 'Do you think children should be encouraged to read more?' }
    ]
  },
  {
    id: 'p1-technology',
    title: 'Technology & Daily Apps',
    questions: [
      { id: 'p1-technology-1', text: 'What type of technology do you use most frequently?' },
      { id: 'p1-technology-2', text: 'Which mobile application is most essential to your daily life?' },
      { id: 'p1-technology-3', text: 'Do you think technology makes our lives simpler or more complex?' },
      { id: 'p1-technology-4', text: 'How did you learn to use computers or smartphones?' },
      { id: 'p1-technology-5', text: 'How often do you use social media platforms?' },
      { id: 'p1-technology-6', text: 'Are there any new technological devices you would like to buy soon?' }
    ]
  },
  {
    id: 'p1-food',
    title: 'Food & Culinary Habits',
    questions: [
      { id: 'p1-food-1', text: 'Do you prefer eating meals at home or dining out?' },
      { id: 'p1-food-2', text: 'What is your favorite type of cuisine to eat?' },
      { id: 'p1-food-3', text: 'Do you enjoy cooking for yourself or others?' },
      { id: 'p1-food-4', text: 'What was your favorite meal or dish during your childhood?' },
      { id: 'p1-food-5', text: 'Are there any foods that you dislike or try to avoid?' },
      { id: 'p1-food-6', text: 'How have your food preferences changed over the years?' }
    ]
  },
  {
    id: 'p1-sports',
    title: 'Sports & Physical Exercise',
    questions: [
      { id: 'p1-sports-1', text: 'Do you play any sports or do regular physical exercise?' },
      { id: 'p1-sports-2', text: 'What is the most popular sport in your country?' },
      { id: 'p1-sports-3', text: 'Do you prefer playing sports or watching them on television?' },
      { id: 'p1-sports-4', text: 'Did you enjoy physical education classes at school?' },
      { id: 'p1-sports-5', text: 'What physical activity would you like to try in the future?' },
      { id: 'p1-sports-6', text: 'Do you think public outdoor exercise equipment is beneficial?' }
    ]
  },
  {
    id: 'p1-music',
    title: 'Music & Artistic Expression',
    questions: [
      { id: 'p1-music-1', text: 'What genre of music do you listen to when you want to relax?' },
      { id: 'p1-music-2', text: 'Have you ever learned to play a musical instrument?' },
      { id: 'p1-music-3', text: 'Do you prefer listening to recorded music or attending live concerts?' },
      { id: 'p1-music-4', text: 'How did your taste in music develop as you grew older?' },
      { id: 'p1-music-5', text: 'Do you think music should be a mandatory subject in schools?' },
      { id: 'p1-music-6', text: 'When do you typically listen to music during the day?' }
    ]
  },
  {
    id: 'p1-nature',
    title: 'Nature & Natural Settings',
    questions: [
      { id: 'p1-nature-1', text: 'How often do you spend time outdoors in natural environments?' },
      { id: 'p1-nature-2', text: 'What is your favorite type of natural landscape (e.g., mountains, beaches)?' },
      { id: 'p1-nature-3', text: 'Are there any public parks or green spaces near your residence?' },
      { id: 'p1-nature-4', text: 'Do you think it is important for cities to have green spaces?' },
      { id: 'p1-nature-5', text: 'Did you enjoy learning about nature or science in school?' },
      { id: 'p1-nature-6', text: 'What can individuals do to help protect local natural habits?' }
    ]
  }
];

// 2. Part 2 Cue Cards with Linked Part 3 Questions (12 cue cards total)
export const CUE_CARDS_BANK = [
  {
    id: 'cue-p2-historic-site',
    title: 'A Historic Site',
    taskStatement: 'Describe a memorable historical site or monument you have visited.',
    bulletPrompts: [
      'Where this historical site is located',
      'When you went there and who accompanied you',
      'What specific historical event or architecture is associated with it',
      'And explain what made this site particularly memorable to you'
    ],
    closingQuestion: 'Would you visit this site again?',
    part3Questions: [
      { id: 'p3-historic-1', type: 'explanation' as const, text: 'Can you explain why nations put so much effort into preserving historical landmarks?' },
      { id: 'p3-historic-2', type: 'comparison' as const, text: 'How do historical preservation priorities compare between older and newer countries?' },
      { id: 'p3-historic-3', type: 'causes' as const, text: 'What are the main causes behind the deterioration of ancient monuments?' },
      { id: 'p3-historic-4', type: 'effects' as const, text: 'What are the social and economic effects of high tourist numbers at historical ruins?' },
      { id: 'p3-historic-5', type: 'future_speculation' as const, text: 'Do you think virtual reality will eventually replace physical visits to historical sites?' }
    ]
  },
  {
    id: 'cue-p2-park',
    title: 'A Local Green Space',
    taskStatement: 'Describe a local community park or green space that you enjoy visiting.',
    bulletPrompts: [
      'Where it is located and how frequently you go',
      'What facilities and natural features it contains',
      'What activities people usually do there',
      'And explain why this park is valuable to your local community'
    ],
    closingQuestion: 'Do you think most people in your town use this park?',
    part3Questions: [
      { id: 'p3-park-1', type: 'explanation' as const, text: 'Why are public parks considered essential elements of modern urban planning?' },
      { id: 'p3-park-2', type: 'comparison' as const, text: 'How do recreational choices differ between people living near parks and those in high-density concrete zones?' },
      { id: 'p3-park-3', type: 'causes' as const, text: 'What causes certain public parks to become neglected or unsafe over time?' },
      { id: 'p3-park-4', type: 'effects' as const, text: 'What positive physical and mental effects do green spaces have on urban populations?' },
      { id: 'p3-park-5', type: 'future_speculation' as const, text: 'How might urban parks evolve in the future as cities become more densely populated?' }
    ]
  },
  {
    id: 'cue-p2-productivity-tech',
    title: 'Productivity Technology',
    taskStatement: 'Describe a piece of technology or a software application that has significantly improved your productivity.',
    bulletPrompts: [
      'What the technology or application is',
      'How you discovered it and how long you have used it',
      'What specific tasks you perform using this tool',
      'And explain how it has changed your daily efficiency or output'
    ],
    closingQuestion: 'Do you think others in your field use this tool?',
    part3Questions: [
      { id: 'p3-tech-1', type: 'explanation' as const, text: 'Can you explain how automation tools are reshaping the traditional eight-hour workday?' },
      { id: 'p3-tech-2', type: 'comparison' as const, text: 'How does digital productivity compare to older pen-and-paper working methods in terms of focus?' },
      { id: 'p3-tech-3', type: 'causes' as const, text: 'What drives the high levels of screen fatigue and digital distraction in modern offices?' },
      { id: 'p3-tech-4', type: 'effects' as const, text: 'What are the effects of constant connectivity on employee work-life balance?' },
      { id: 'p3-tech-5', type: 'future_speculation' as const, text: 'What kinds of productivity technologies do you speculate will dominate in the next decade?' }
    ]
  },
  {
    id: 'cue-p2-deep-book',
    title: 'An Influential Book',
    taskStatement: 'Describe a book or written story that left a deep, lasting impression on you.',
    bulletPrompts: [
      'What the book was and who wrote it',
      'What the main theme or storyline of the book was',
      'Why you decided to read it in the first place',
      'And explain what insights or emotions it left with you'
    ],
    closingQuestion: 'Would you recommend this book to someone who is busy?',
    part3Questions: [
      { id: 'p3-book-1', type: 'explanation' as const, text: 'Why does literature often have a more profound impact on personal beliefs than quick social media posts?' },
      { id: 'p3-book-2', type: 'comparison' as const, text: 'How do the cognitive benefits of reading long-form books compare to watching film adaptations?' },
      { id: 'p3-book-3', type: 'causes' as const, text: 'What factors cause certain literary works to become timeless classics across different generations?' },
      { id: 'p3-book-4', type: 'effects' as const, text: 'What are the societal effects of a decline in reading habits among younger generations?' },
      { id: 'p3-book-5', type: 'future_speculation' as const, text: 'Will digital self-publishing change the quality of books we read in the future?' }
    ]
  },
  {
    id: 'cue-p2-sport-try',
    title: 'A New Sport',
    taskStatement: 'Describe a sport or physical activity you tried for the first time.',
    bulletPrompts: [
      'What the sport or physical activity was',
      'Where and when you tried it',
      'What equipment or rules were involved',
      'And explain what challenges you faced and how you felt afterward'
    ],
    closingQuestion: 'Do you practice this sport regularly now?',
    part3Questions: [
      { id: 'p3-sport-1', type: 'explanation' as const, text: 'Why do some individuals enjoy participating in extreme or high-risk sporting activities?' },
      { id: 'p3-sport-2', type: 'comparison' as const, text: 'How do the social benefits of team sports compare to individual fitness activities?' },
      { id: 'p3-sport-3', type: 'causes' as const, text: 'What causes certain sports to gain international popularity while others remain strictly localized?' },
      { id: 'p3-sport-4', type: 'effects' as const, text: 'What are the health and economic effects of hosting major global sporting events like the Olympics?' },
      { id: 'p3-sport-5', type: 'future_speculation' as const, text: 'Do you think e-sports will eventually be viewed as equal to traditional physical sports?' }
    ]
  },
  {
    id: 'cue-p2-life-skill',
    title: 'An Important Life Skill',
    taskStatement: 'Describe an influential person who taught you an important life skill.',
    bulletPrompts: [
      'Who this person is and how you know them',
      'What specific life skill they taught you',
      'How they went about teaching you this skill',
      'And explain how this skill has influenced your personal or professional life'
    ],
    closingQuestion: 'Have you ever passed this skill on to anyone else?',
    part3Questions: [
      { id: 'p3-skill-1', type: 'explanation' as const, text: 'Why are soft skills like empathy and negotiation often harder to teach than academic knowledge?' },
      { id: 'p3-skill-2', type: 'comparison' as const, text: 'How does learning a skill through real-life experience compare to studying it in a classroom?' },
      { id: 'p3-skill-3', type: 'causes' as const, text: 'What causes some mentors to be highly effective while others fail to inspire their students?' },
      { id: 'p3-skill-4', type: 'effects' as const, text: 'What are the economic effects of a workforce that lacks basic self-management skills?' },
      { id: 'p3-skill-5', type: 'future_speculation' as const, text: 'What life skills do you think will become absolutely critical for survival in the automated future?' }
    ]
  },
  {
    id: 'cue-p2-green-habit',
    title: 'An Eco-Friendly Habit',
    taskStatement: 'Describe an eco-friendly habit or lifestyle practice you have adopted.',
    bulletPrompts: [
      'What the habit or practice is',
      'When and why you decided to start doing it',
      'How easy or difficult it is to maintain in your daily routine',
      'And explain how this habit contributes to environmental sustainability'
    ],
    closingQuestion: 'Do your friends or family members share this habit?',
    part3Questions: [
      { id: 'p3-green-1', type: 'explanation' as const, text: 'Why is there often a gap between people supporting environmental protection and actively practicing green habits?' },
      { id: 'p3-green-2', type: 'comparison' as const, text: 'How do individual conservation habits compare to governmental regulations in combating climate change?' },
      { id: 'p3-green-3', type: 'causes' as const, text: 'What are the primary causes behind the excessive production of single-use consumer waste?' },
      { id: 'p3-green-4', type: 'effects' as const, text: 'What are the environmental effects of massive plastic pollution in urban rivers and oceans?' },
      { id: 'p3-green-5', type: 'future_speculation' as const, text: 'Do you believe green technologies will fully reverse environmental damage in the next fifty years?' }
    ]
  },
  {
    id: 'cue-p2-emotional-gift',
    title: 'A Meaningful Gift',
    taskStatement: 'Describe a special gift or item of deep emotional significance to you.',
    bulletPrompts: [
      'What the item is and who gave it to you',
      'On what occasion you received this gift',
      'What characteristics or history make this item unique',
      'And explain why this gift holds such a deep emotional value for you'
    ],
    closingQuestion: 'Do you keep this item in a safe place?',
    part3Questions: [
      { id: 'p3-gift-1', type: 'explanation' as const, text: 'Why do handmade gifts often carry much higher sentimental value than expensive store-bought items?' },
      { id: 'p3-gift-2', type: 'comparison' as const, text: 'How do modern gift-giving trends compare to traditional gifting practices of past generations?' },
      { id: 'p3-gift-3', type: 'causes' as const, text: 'What causes consumerism to dominate commercial holidays, shifting the focus away from genuine connection?' },
      { id: 'p3-gift-4', type: 'effects' as const, text: 'What are the psychological effects of hoarding sentimental items rather than practicing minimalism?' },
      { id: 'p3-gift-5', type: 'future_speculation' as const, text: 'Will digital gifts, such as virtual experiences, replace tangible material gifts in the future?' }
    ]
  },
  {
    id: 'cue-p2-team-project',
    title: 'A Challenging Project',
    taskStatement: 'Describe a challenging team project or assignment you contributed to.',
    bulletPrompts: [
      'What the project was and what goal you had to achieve',
      'Who you worked with and what role you played',
      'What main difficulties the team encountered during the project',
      'And explain how the team resolved these issues and how you felt about the outcome'
    ],
    closingQuestion: 'Do you still communicate with your project teammates?',
    part3Questions: [
      { id: 'p3-project-1', type: 'explanation' as const, text: 'Why is clear and open communication considered the single most critical factor in successful teamwork?' },
      { id: 'p3-project-2', type: 'comparison' as const, text: 'How does the performance of a highly diverse, multidisciplinary team compare to a homogeneous team?' },
      { id: 'p3-project-3', type: 'causes' as const, text: 'What are the most common causes of interpersonal conflict or division within professional groups?' },
      { id: 'p3-project-4', type: 'effects' as const, text: 'What are the organizational effects of low team morale on deadlines and creative output?' },
      { id: 'p3-project-5', type: 'future_speculation' as const, text: 'How will virtual remote collaboration tools shape team dynamics in the next ten years?' }
    ]
  },
  {
    id: 'cue-p2-traditional-festival',
    title: 'A Cultural Festival',
    taskStatement: 'Describe a traditional custom or cultural festival from your home country.',
    bulletPrompts: [
      'What the custom or festival is and when it takes place',
      'What specific historical or cultural rituals are performed',
      'What foods, decorations, or clothes are associated with it',
      'And explain what importance this custom holds for the people of your country'
    ],
    closingQuestion: 'Is this festival celebrated widely by younger generations?',
    part3Questions: [
      { id: 'p3-festival-1', type: 'explanation' as const, text: 'Why do ancient customs and traditional festivals remain popular in highly modernized societies?' },
      { id: 'p3-festival-2', type: 'comparison' as const, text: 'How do globalized commercial holidays compare to unique local cultural festivals in terms of meaning?' },
      { id: 'p3-festival-3', type: 'causes' as const, text: 'What factors cause certain traditional practices to face extinction among younger urban populations?' },
      { id: 'p3-festival-4', type: 'effects' as const, text: 'What are the tourism and national identity effects of promoting traditional culture on the world stage?' },
      { id: 'p3-festival-5', type: 'future_speculation' as const, text: 'Do you foresee traditional customs blending with digital technologies to create virtual festivals?' }
    ]
  },
  {
    id: 'cue-p2-interesting-town',
    title: 'An Interesting Town',
    taskStatement: 'Describe an interesting neighborhood or town you explored recently.',
    bulletPrompts: [
      'Where it is located and how you traveled there',
      'What outstanding architectural or geographic features it has',
      'What local activities, shops, or cafes you discovered there',
      'And explain what made this place unique and interesting to explore'
    ],
    closingQuestion: 'Would you consider living in that area permanently?',
    part3Questions: [
      { id: 'p3-town-1', type: 'explanation' as const, text: 'Why do specific neighborhoods manage to cultivate a highly distinct artistic or historical vibe?' },
      { id: 'p3-town-2', type: 'comparison' as const, text: 'How do modern commercial strip malls compare to historical local neighborhood markets in terms of community bonding?' },
      { id: 'p3-town-3', type: 'causes' as const, text: 'What causes rapid gentrification in older suburbs, and how does it affect long-term residents?' },
      { id: 'p3-town-4', type: 'effects' as const, text: 'What are the social and economic effects of turning quiet residential neighborhoods into hot tourist spots?' },
      { id: 'p3-town-5', type: 'future_speculation' as const, text: 'How might the rise of remote work change the population distribution between major cities and small rural towns?' }
    ]
  },
  {
    id: 'cue-p2-creative-hobby',
    title: 'A Creative Activity',
    taskStatement: 'Describe a creative hobby or artistic activity you enjoy doing.',
    bulletPrompts: [
      'What the creative activity is and how you got started',
      'What materials, tools, or skills are required for it',
      'How often you engage in this activity and what you create',
      'And explain how this creative outlet helps you express yourself or relax'
    ],
    closingQuestion: 'Is this hobby expensive to maintain?',
    part3Questions: [
      { id: 'p3-hobby-1', type: 'explanation' as const, text: 'Why is creative and artistic expression considered an essential aspect of human psychological well-being?' },
      { id: 'p3-hobby-2', type: 'comparison' as const, text: 'How does the focus required for slow, hands-on crafting compare to the consumption of high-speed digital media?' },
      { id: 'p3-hobby-3', type: 'causes' as const, text: 'What causes some schools to reduce funding for arts education in favor of technical STEM subjects?' },
      { id: 'p3-hobby-4', type: 'effects' as const, text: 'What are the economic and cultural effects of having a thriving community of local artisans and creators?' },
      { id: 'p3-hobby-5', type: 'future_speculation' as const, text: 'Will generative AI writing and painting tools replace the human desire to learn manual creative crafts?' }
    ]
  }
];

/**
 * Deterministically generates an immutable SelectedTestSnapshot based on a seed and mode.
 */
export function generateTestSnapshot(
  seed: string,
  mode: 'full' | 'part1' | 'part2' | 'part3',
  cueCardId?: string
): SelectedTestSnapshot {
  const rng = getSeededRandom(seed);
  
  const snapshot: SelectedTestSnapshot = {
    seed,
    mode
  };

  // Determine Part 1 selection if requested (full or part1)
  if (mode === 'full' || mode === 'part1') {
    // A realistic Part 1 is a short interview across more than one familiar
    // topic. Select TWO distinct topic frames and FOUR stored questions from
    // each (8 questions total). This gives the examiner enough material for a
    // natural 4-5 minute Part 1 without inventing unscripted questions.
    const topicIndices = Array.from({ length: PART_1_TOPICS.length }, (_, i) => i);
    for (let i = topicIndices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [topicIndices[i], topicIndices[j]] = [topicIndices[j], topicIndices[i]];
    }

    const selectedTopicGroups: SelectedTestPart1Group[] = topicIndices.slice(0, 2).map((topicIndex) => {
      const selectedGroup = PART_1_TOPICS[topicIndex];
      const questionIndices = Array.from({ length: selectedGroup.questions.length }, (_, i) => i);

      for (let i = questionIndices.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [questionIndices[i], questionIndices[j]] = [questionIndices[j], questionIndices[i]];
      }

      // Preserve the natural order from the source topic frame after choosing
      // four questions deterministically.
      const chosen = questionIndices.slice(0, 4).sort((a, b) => a - b);
      return {
        id: selectedGroup.id,
        title: selectedGroup.title,
        questions: chosen.map((idx) => ({
          id: selectedGroup.questions[idx].id,
          text: selectedGroup.questions[idx].text
        }))
      };
    });

    snapshot.part1Topics = selectedTopicGroups;

    // Backwards-compatible flattened view for the current state machine.
    snapshot.part1Topic = {
      id: selectedTopicGroups.map((group) => group.id).join('__'),
      title: selectedTopicGroups.map((group) => group.title).join(' / '),
      questions: selectedTopicGroups.flatMap((group) => group.questions)
    };
  }

  // Determine Part 2 theme and linked Part 3 questions when requested.
  if (mode === 'full' || mode === 'part2' || mode === 'part3') {
    let selectedSourceCard = CUE_CARDS_BANK[0];
    if (cueCardId) {
      const found = CUE_CARDS_BANK.find((c) => c.id === cueCardId);
      if (found) {
        selectedSourceCard = found;
      } else {
        const cardIndex = Math.floor(rng() * CUE_CARDS_BANK.length);
        selectedSourceCard = CUE_CARDS_BANK[cardIndex];
      }
    } else {
      const cardIndex = Math.floor(rng() * CUE_CARDS_BANK.length);
      selectedSourceCard = CUE_CARDS_BANK[cardIndex];
    }

    snapshot.part2CueCard = {
      id: selectedSourceCard.id,
      title: selectedSourceCard.title,
      taskStatement: selectedSourceCard.taskStatement,
      bulletPrompts: [...selectedSourceCard.bulletPrompts],
      closingQuestion: selectedSourceCard.closingQuestion
    };

    // Linked Part 3 Questions
    // Make copies to avoid reference sharing
    snapshot.part3Questions = selectedSourceCard.part3Questions.map((q) => ({
      id: q.id,
      text: q.text,
      type: q.type
    }));
  }

  return snapshot;
}
