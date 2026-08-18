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

// 2. Part 2 Cue Cards with Linked Part 3 Questions
// 21 IELTS-style topic sets adapted from the topic coverage on IELTSMaterial.
// The wording below is original so the app does not reproduce third-party questions verbatim.
export const CUE_CARDS_BANK = [
  {
    id: 'cue-p2-dream-home',
    title: 'A Home You Would Like to Live In',
    taskStatement: 'Describe a house or apartment that would be ideal for you to live in.',
    bulletPrompts: [
      'Where you would like this home to be',
      'What the home would look like and what features it would have',
      'Who you would like to live there with',
      'And explain why this kind of home would suit you well'
    ],
    closingQuestion: 'Do you think you could realistically live in a place like this one day?',
    part3Questions: [
      { id: 'p3-home-1', type: 'comparison' as const, text: 'What are the main differences between renting a home and owning one?' },
      { id: 'p3-home-2', type: 'causes' as const, text: 'Why is affordable housing difficult to find in many large cities?' },
      { id: 'p3-home-3', type: 'explanation' as const, text: 'At what stage of life do people usually want to live independently from their parents, and why?' },
      { id: 'p3-home-4', type: 'effects' as const, text: 'How can high housing costs affect young couples and new families?' },
      { id: 'p3-home-5', type: 'future_speculation' as const, text: 'How do you think homes and residential areas will change over the next twenty years?' }
    ]
  },
  {
    id: 'cue-p2-interesting-animal',
    title: 'An Interesting Animal',
    taskStatement: 'Describe an animal that you found especially interesting when you saw it.',
    bulletPrompts: [
      'What the animal was',
      'Where and when you saw it',
      'What the animal was doing or what made it noticeable',
      'And explain why it made a strong impression on you'
    ],
    closingQuestion: 'Would you like to see this animal again?',
    part3Questions: [
      { id: 'p3-animal-1', type: 'explanation' as const, text: 'Why do people choose to keep certain animals as pets?' },
      { id: 'p3-animal-2', type: 'causes' as const, text: 'What are the main reasons some animal species are becoming endangered?' },
      { id: 'p3-animal-3', type: 'comparison' as const, text: 'How has the role of animals in human work changed compared with the past?' },
      { id: 'p3-animal-4', type: 'effects' as const, text: 'What effects can the loss of animal species have on ecosystems and people?' },
      { id: 'p3-animal-5', type: 'future_speculation' as const, text: 'Do you think people will have a different relationship with animals in the future?' }
    ]
  },
  {
    id: 'cue-p2-small-business',
    title: 'A Successful Small Business',
    taskStatement: 'Describe a small business that you know and consider successful.',
    bulletPrompts: [
      'What the business is and what it provides',
      'Where it operates and who its customers are',
      'How you learned about the business',
      'And explain why you think it has become successful'
    ],
    closingQuestion: 'Would you personally consider starting a business like this?',
    part3Questions: [
      { id: 'p3-business-1', type: 'explanation' as const, text: 'What personal qualities help someone become an effective business leader?' },
      { id: 'p3-business-2', type: 'causes' as const, text: 'What factors usually determine whether a small business survives and grows?' },
      { id: 'p3-business-3', type: 'effects' as const, text: 'How can technology change the way a small company competes with larger businesses?' },
      { id: 'p3-business-4', type: 'comparison' as const, text: 'How is running your own business different from working as an employee?' },
      { id: 'p3-business-5', type: 'future_speculation' as const, text: 'What types of small businesses do you think will become more common in the future?' }
    ]
  },
  {
    id: 'cue-p2-crowded-place',
    title: 'A Crowded Place',
    taskStatement: 'Describe a very crowded place that you have visited.',
    bulletPrompts: [
      'Where the place was',
      'When you went there and who you were with',
      'Why there were so many people there',
      'And explain how you felt while you were in that crowd'
    ],
    closingQuestion: 'Would you willingly go back there at a similarly busy time?',
    part3Questions: [
      { id: 'p3-crowd-1', type: 'explanation' as const, text: 'Why do some people enjoy busy and crowded places while others avoid them?' },
      { id: 'p3-crowd-2', type: 'causes' as const, text: 'What makes certain parts of a city much more crowded than others?' },
      { id: 'p3-crowd-3', type: 'effects' as const, text: 'What problems can overcrowding create for people who live in large cities?' },
      { id: 'p3-crowd-4', type: 'comparison' as const, text: 'How is life in a densely populated city different from life in a smaller town?' },
      { id: 'p3-crowd-5', type: 'future_speculation' as const, text: 'How could better urban planning reduce crowding problems in future cities?' }
    ]
  },
  {
    id: 'cue-p2-family-member',
    title: 'A Family Member You Spend Time With',
    taskStatement: 'Describe a family member with whom you spend a lot of time.',
    bulletPrompts: [
      'Who this person is',
      'What kind of person they are',
      'What you usually do together',
      'And explain why you enjoy spending time with this person'
    ],
    closingQuestion: 'Do you think you will continue spending as much time together in the future?',
    part3Questions: [
      { id: 'p3-family-1', type: 'effects' as const, text: 'What benefits can strong family relationships bring to individuals?' },
      { id: 'p3-family-2', type: 'comparison' as const, text: 'How is living in an extended family different from living in a small nuclear family?' },
      { id: 'p3-family-3', type: 'causes' as const, text: 'Why are multigenerational households common in some societies but less common in others?' },
      { id: 'p3-family-4', type: 'explanation' as const, text: 'How should parents share responsibilities for raising children?' },
      { id: 'p3-family-5', type: 'future_speculation' as const, text: 'Do you think family structures will become more independent or more connected in the future?' }
    ]
  },
  {
    id: 'cue-p2-news-person',
    title: 'A Person Often Seen in the News',
    taskStatement: 'Describe a person who appears in the news frequently and whom you would be interested to meet.',
    bulletPrompts: [
      'Who this person is',
      'How you first became aware of them',
      'Why they receive a lot of media attention',
      'And explain why meeting this person would interest you'
    ],
    closingQuestion: 'What would be the first thing you would ask this person?',
    part3Questions: [
      { id: 'p3-news-1', type: 'comparison' as const, text: 'How is news from social media different from news from traditional newspapers or television?' },
      { id: 'p3-news-2', type: 'explanation' as const, text: 'What makes people trust one news source more than another?' },
      { id: 'p3-news-3', type: 'effects' as const, text: 'How has social media changed the way people react to breaking news?' },
      { id: 'p3-news-4', type: 'causes' as const, text: 'Why do some public figures receive far more media coverage than others?' },
      { id: 'p3-news-5', type: 'future_speculation' as const, text: 'How do you think people will get their news ten years from now?' }
    ]
  },
  {
    id: 'cue-p2-local-change',
    title: 'A Change That Would Improve Your Local Area',
    taskStatement: 'Describe one change that you believe would make your local area a better place to live.',
    bulletPrompts: [
      'What change you would like to see',
      'What problem the change would address',
      'Who would need to help make it happen',
      'And explain how local residents would benefit from it'
    ],
    closingQuestion: 'Do you think local people would support this change?',
    part3Questions: [
      { id: 'p3-local-1', type: 'causes' as const, text: 'Why are some people uncomfortable when their neighborhood changes quickly?' },
      { id: 'p3-local-2', type: 'explanation' as const, text: 'How important is it for neighbors to know and communicate with each other?' },
      { id: 'p3-local-3', type: 'comparison' as const, text: 'How do people socialize with neighbors differently in cities and smaller communities?' },
      { id: 'p3-local-4', type: 'effects' as const, text: 'What can happen to a community when residents have very little contact with one another?' },
      { id: 'p3-local-5', type: 'future_speculation' as const, text: 'What kinds of local improvements will urban communities need most in the future?' }
    ]
  },
  {
    id: 'cue-p2-performance',
    title: 'A Performance You Enjoyed',
    taskStatement: 'Describe a performance that you watched and really enjoyed.',
    bulletPrompts: [
      'What kind of performance it was',
      'Where and when you watched it',
      'Who performed and what happened during it',
      'And explain why the performance was enjoyable for you'
    ],
    closingQuestion: 'Would you like to watch this kind of performance live again?',
    part3Questions: [
      { id: 'p3-performance-1', type: 'explanation' as const, text: 'Why are traditional performances still important in many cultures?' },
      { id: 'p3-performance-2', type: 'comparison' as const, text: 'How does watching a performance live differ from watching a recording at home?' },
      { id: 'p3-performance-3', type: 'effects' as const, text: 'How can exposure to music, dance, or theatre influence children?' },
      { id: 'p3-performance-4', type: 'causes' as const, text: 'Why do some forms of live entertainment remain popular despite online streaming?' },
      { id: 'p3-performance-5', type: 'future_speculation' as const, text: 'How might live performances change as digital technology becomes more advanced?' }
    ]
  },
  {
    id: 'cue-p2-important-message',
    title: 'An Important Message',
    taskStatement: 'Describe an important text or online message that you received.',
    bulletPrompts: [
      'Who sent the message',
      'When you received it',
      'What the message was about',
      'And explain why the message mattered to you'
    ],
    closingQuestion: 'Did you reply to the message immediately?',
    part3Questions: [
      { id: 'p3-message-1', type: 'causes' as const, text: 'Why do many people prefer sending messages instead of making phone calls?' },
      { id: 'p3-message-2', type: 'comparison' as const, text: 'What are the main differences between written and spoken communication?' },
      { id: 'p3-message-3', type: 'effects' as const, text: 'How has instant messaging affected the quality of everyday communication?' },
      { id: 'p3-message-4', type: 'explanation' as const, text: 'Why do some people dislike communicating through text messages?' },
      { id: 'p3-message-5', type: 'future_speculation' as const, text: 'How do you think personal communication will change as technology develops further?' }
    ]
  },
  {
    id: 'cue-p2-uniform',
    title: 'A Uniform You Have Worn',
    taskStatement: 'Describe a uniform that you have had to wear for school, work, or another activity.',
    bulletPrompts: [
      'What the uniform looked like',
      'Where and when you had to wear it',
      'Why the uniform was required',
      'And explain how you felt about wearing it'
    ],
    closingQuestion: 'Would you change anything about that uniform?',
    part3Questions: [
      { id: 'p3-uniform-1', type: 'comparison' as const, text: 'What are the advantages and disadvantages of requiring people to wear uniforms?' },
      { id: 'p3-uniform-2', type: 'explanation' as const, text: 'Why do schools and some professions use uniforms?' },
      { id: 'p3-uniform-3', type: 'effects' as const, text: 'How can uniforms influence equality, identity, or discipline in a group?' },
      { id: 'p3-uniform-4', type: 'causes' as const, text: 'Why do people often use clothing to express their personality?' },
      { id: 'p3-uniform-5', type: 'future_speculation' as const, text: 'Do you think uniforms will become more or less common in workplaces in the future?' }
    ]
  },
  {
    id: 'cue-p2-apology',
    title: 'A Time Someone Apologized to You',
    taskStatement: 'Describe an occasion when someone gave you a sincere apology.',
    bulletPrompts: [
      'Who apologized to you',
      'What had happened before the apology',
      'What the person said or did to apologize',
      'And explain how you felt after receiving the apology'
    ],
    closingQuestion: 'Did the apology change your relationship with that person?',
    part3Questions: [
      { id: 'p3-apology-1', type: 'explanation' as const, text: 'Why is it easy for some people to apologize but difficult for others?' },
      { id: 'p3-apology-2', type: 'causes' as const, text: 'What situations most commonly lead people to say sorry?' },
      { id: 'p3-apology-3', type: 'effects' as const, text: 'What can happen to a relationship when one person refuses to apologize?' },
      { id: 'p3-apology-4', type: 'comparison' as const, text: 'Are apologies between friends different from apologies in professional situations?' },
      { id: 'p3-apology-5', type: 'future_speculation' as const, text: 'Do you think online communication will make sincere apologies easier or harder in the future?' }
    ]
  },
  {
    id: 'cue-p2-health-article',
    title: 'A Useful Health Article',
    taskStatement: 'Describe an article or online post you read that gave useful advice about improving health.',
    bulletPrompts: [
      'Where and when you read it',
      'What health topic it discussed',
      'What advice or information it provided',
      'And explain why you thought the information could be helpful'
    ],
    closingQuestion: 'Did the article change any of your own habits?',
    part3Questions: [
      { id: 'p3-health-1', type: 'explanation' as const, text: 'What are the most realistic ways for ordinary people to improve their health?' },
      { id: 'p3-health-2', type: 'comparison' as const, text: 'How do younger and older people usually approach healthy living differently?' },
      { id: 'p3-health-3', type: 'effects' as const, text: 'How can schools influence the long-term health habits of children?' },
      { id: 'p3-health-4', type: 'causes' as const, text: 'Why do people sometimes ignore health advice even when they know it is useful?' },
      { id: 'p3-health-5', type: 'future_speculation' as const, text: 'Do you expect people to become healthier or less healthy in the future?' }
    ]
  },
  {
    id: 'cue-p2-public-transport',
    title: 'A Journey by Public Transport',
    taskStatement: 'Describe a journey you made using public transport.',
    bulletPrompts: [
      'When and where the journey took place',
      'What type of public transport you used',
      'What happened during the journey',
      'And explain how you felt about the experience'
    ],
    closingQuestion: 'Would you choose the same form of transport for that journey again?',
    part3Questions: [
      { id: 'p3-transport-1', type: 'effects' as const, text: 'How could cheaper or free public transport affect traffic congestion?' },
      { id: 'p3-transport-2', type: 'causes' as const, text: 'Why do more people choose air travel for long-distance journeys today?' },
      { id: 'p3-transport-3', type: 'explanation' as const, text: 'What difficulties do governments face when improving public transport systems?' },
      { id: 'p3-transport-4', type: 'comparison' as const, text: 'How does travelling by private car compare with travelling by public transport?' },
      { id: 'p3-transport-5', type: 'future_speculation' as const, text: 'What changes do you expect in public transport over the next few decades?' }
    ]
  },
  {
    id: 'cue-p2-challenge',
    title: 'A Challenging Thing You Did',
    taskStatement: 'Describe something difficult that you chose or needed to do.',
    bulletPrompts: [
      'What the challenge was',
      'When and why you decided to do it',
      'What made it difficult',
      'And explain how you managed the challenge and what you learned from it'
    ],
    closingQuestion: 'Would you take on a similar challenge again?',
    part3Questions: [
      { id: 'p3-challenge-1', type: 'explanation' as const, text: 'What kinds of challenges are common for young people today?' },
      { id: 'p3-challenge-2', type: 'comparison' as const, text: 'Is it better to solve difficult problems independently or to ask others for help?' },
      { id: 'p3-challenge-3', type: 'causes' as const, text: 'Why do some people actively seek difficult goals while others avoid them?' },
      { id: 'p3-challenge-4', type: 'effects' as const, text: 'How can overcoming difficult experiences affect a person’s confidence?' },
      { id: 'p3-challenge-5', type: 'future_speculation' as const, text: 'What new challenges do you think young people will face in the future?' }
    ]
  },
  {
    id: 'cue-p2-important-teacher',
    title: 'A Person Who Taught You Something Important',
    taskStatement: 'Describe a person who taught you something that became important in your life.',
    bulletPrompts: [
      'Who the person was',
      'What they taught you',
      'How they helped you learn it',
      'And explain why this lesson or skill became important to you'
    ],
    closingQuestion: 'Have you used what this person taught you recently?',
    part3Questions: [
      { id: 'p3-teacher-1', type: 'explanation' as const, text: 'How can adults encourage children to become interested in learning?' },
      { id: 'p3-teacher-2', type: 'comparison' as const, text: 'How are the educational roles of parents and teachers different?' },
      { id: 'p3-teacher-3', type: 'causes' as const, text: 'Why are some people more willing than others to accept new ideas or methods?' },
      { id: 'p3-teacher-4', type: 'effects' as const, text: 'What long-term effect can an inspiring teacher have on a student?' },
      { id: 'p3-teacher-5', type: 'future_speculation' as const, text: 'How might the role of teachers change as digital learning tools become more common?' }
    ]
  },
  {
    id: 'cue-p2-team-member',
    title: 'A Memorable Team Member',
    taskStatement: 'Describe someone you know who was an effective or memorable member of a team.',
    bulletPrompts: [
      'What team this person belonged to',
      'What role they had in the team',
      'What qualities or actions made them stand out',
      'And explain why you respected or liked this person as a team member'
    ],
    closingQuestion: 'Would you like to work with this person on a team yourself?',
    part3Questions: [
      { id: 'p3-team-1', type: 'comparison' as const, text: 'In a team, how should individual development be balanced with shared goals?' },
      { id: 'p3-team-2', type: 'effects' as const, text: 'What can children learn from taking part in team activities?' },
      { id: 'p3-team-3', type: 'causes' as const, text: 'What usually causes disagreements between members of a team?' },
      { id: 'p3-team-4', type: 'explanation' as const, text: 'How can schools teach students to cooperate more effectively?' },
      { id: 'p3-team-5', type: 'future_speculation' as const, text: 'How might remote work and online collaboration change teamwork in the future?' }
    ]
  },
  {
    id: 'cue-p2-unwanted-job',
    title: 'A Job You Would Not Like to Do',
    taskStatement: 'Describe a type of job that you would prefer not to do.',
    bulletPrompts: [
      'What the job is',
      'How you know about this kind of work',
      'What responsibilities or difficulties the job involves',
      'And explain why this job would not suit you'
    ],
    closingQuestion: 'Is there anything that could make this job more attractive to you?',
    part3Questions: [
      { id: 'p3-job-1', type: 'effects' as const, text: 'How is artificial intelligence likely to affect employment in different industries?' },
      { id: 'p3-job-2', type: 'explanation' as const, text: 'What should people consider most carefully when choosing a career?' },
      { id: 'p3-job-3', type: 'causes' as const, text: 'Why do people move to another city or country for work?' },
      { id: 'p3-job-4', type: 'comparison' as const, text: 'For young workers, how should salary be balanced against personal interest in a job?' },
      { id: 'p3-job-5', type: 'future_speculation' as const, text: 'Which kinds of jobs do you think will grow or disappear in the future?' }
    ]
  },
  {
    id: 'cue-p2-exciting-experience',
    title: 'An Exciting Experience',
    taskStatement: 'Describe something exciting that you did and remember clearly.',
    bulletPrompts: [
      'What you did',
      'When and where it happened',
      'Who was with you',
      'And explain what made the experience exciting for you'
    ],
    closingQuestion: 'Would you like to repeat this experience?',
    part3Questions: [
      { id: 'p3-exciting-1', type: 'causes' as const, text: 'Why do people enjoy celebrating important personal occasions?' },
      { id: 'p3-exciting-2', type: 'comparison' as const, text: 'How are private family celebrations different from large public celebrations?' },
      { id: 'p3-exciting-3', type: 'effects' as const, text: 'What effect can spending large amounts of money on celebrations have on families?' },
      { id: 'p3-exciting-4', type: 'explanation' as const, text: 'Why are traditional festivals often more enjoyable when people celebrate together?' },
      { id: 'p3-exciting-5', type: 'future_speculation' as const, text: 'Do you think celebrations will become more digital or more experience-based in the future?' }
    ]
  },
  {
    id: 'cue-p2-no-phone',
    title: 'A Time You Could Not Use Your Phone',
    taskStatement: 'Describe an occasion when you were unable or not permitted to use your mobile phone.',
    bulletPrompts: [
      'Where and when this happened',
      'What you were doing at the time',
      'Why you could not use your phone',
      'And explain how you felt about being without it'
    ],
    closingQuestion: 'Was being without your phone easier or harder than you expected?',
    part3Questions: [
      { id: 'p3-phone-1', type: 'explanation' as const, text: 'In what situations should mobile phone use be limited?' },
      { id: 'p3-phone-2', type: 'comparison' as const, text: 'How is smartphone use different for children and adults?' },
      { id: 'p3-phone-3', type: 'causes' as const, text: 'Why do many people find it difficult to spend time without their phones?' },
      { id: 'p3-phone-4', type: 'effects' as const, text: 'What effects can very early smartphone ownership have on children?' },
      { id: 'p3-phone-5', type: 'future_speculation' as const, text: 'Do you think society will introduce stricter rules about phone use in the future?' }
    ]
  },
  {
    id: 'cue-p2-weather-plan',
    title: 'A Plan Changed by the Weather',
    taskStatement: 'Describe a time when the weather forced you to change something you had planned to do.',
    bulletPrompts: [
      'What you had planned',
      'What kind of weather you expected',
      'What weather actually occurred and what you did instead',
      'And explain how you felt about changing your plan'
    ],
    closingQuestion: 'Did the alternative plan turn out well in the end?',
    part3Questions: [
      { id: 'p3-weather-1', type: 'explanation' as const, text: 'Why is the weather such a common topic in everyday conversation?' },
      { id: 'p3-weather-2', type: 'comparison' as const, text: 'How do people’s preferences for hot and cold weather differ?' },
      { id: 'p3-weather-3', type: 'causes' as const, text: 'Which occupations and activities are most affected by weather conditions, and why?' },
      { id: 'p3-weather-4', type: 'effects' as const, text: 'What happens when people or businesses rely on inaccurate weather forecasts?' },
      { id: 'p3-weather-5', type: 'future_speculation' as const, text: 'How might changing climate patterns affect the way people plan daily life in the future?' }
    ]
  },
  {
    id: 'cue-p2-difficult-product',
    title: 'Something Difficult to Use at First',
    taskStatement: 'Describe something you bought or started using that was difficult to operate at first.',
    bulletPrompts: [
      'What the item was',
      'Why you bought or needed it',
      'What was difficult about using it at first',
      'And explain how you eventually learned to use it properly'
    ],
    closingQuestion: 'Do you now find this item easy to use?',
    part3Questions: [
      { id: 'p3-product-1', type: 'causes' as const, text: 'Why do people often buy new products even when their old ones still work?' },
      { id: 'p3-product-2', type: 'effects' as const, text: 'How does advertising influence what people decide to buy?' },
      { id: 'p3-product-3', type: 'comparison' as const, text: 'Why can new technology be easier for younger people to learn than for older people?' },
      { id: 'p3-product-4', type: 'explanation' as const, text: 'What makes a product simple and user-friendly?' },
      { id: 'p3-product-5', type: 'future_speculation' as const, text: 'Do you think future products will become easier to use or more complicated?' }
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
