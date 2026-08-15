import type { IELTSEvaluation, IELTSPracticeSession } from '../types';

interface FeedbackPdfInput {
  evaluation: IELTSEvaluation;
  session: IELTSPracticeSession;
  candidateName?: string | null;
}

type PdfCommand = string;

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 48;
const TOP_Y = 792;
const BOTTOM_Y = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

function asciiText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfText(value: unknown): string {
  return asciiText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(value: unknown, fontSize = 10, width = CONTENT_WIDTH): string[] {
  const text = asciiText(value);
  if (!text) return [];

  const maxChars = Math.max(18, Math.floor(width / Math.max(4.8, fontSize * 0.52)));
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length <= maxChars) {
      current += ` ${word}`;
      continue;
    }

    lines.push(current);
    if (word.length <= maxChars) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > maxChars) {
      lines.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    }
    current = remaining;
  }

  if (current) lines.push(current);
  return lines;
}

function textCommand(text: unknown, x: number, y: number, size: number, bold = false): PdfCommand {
  const font = bold ? '/F2' : '/F1';
  return `BT ${font} ${size} Tf 0.12 0.15 0.20 rg 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET`;
}

function mutedTextCommand(text: unknown, x: number, y: number, size: number): PdfCommand {
  return `BT /F1 ${size} Tf 0.37 0.41 0.47 rg 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET`;
}

function buildPdf(pages: PdfCommand[][]): Blob {
  const objects: string[] = [];
  const pageObjectNumbers: number[] = [];

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  pages.forEach((commands, index) => {
    const pageObjectNumber = 5 + index * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    pageObjectNumbers.push(pageObjectNumber);

    const stream = commands.join('\n');
    objects[pageObjectNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
    objects[contentObjectNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  let pdf = '%PDF-1.4\n% Hexa Education Feedback Report\n';
  const offsets: number[] = [0];
  const maxObjectNumber = objects.length - 1;

  for (let index = 1; index <= maxObjectNumber; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${maxObjectNumber + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= maxObjectNumber; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${maxObjectNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: 'application/pdf' });
}

function testLabel(session: IELTSPracticeSession): string {
  switch (session.selectedTestSnapshot?.mode) {
    case 'part1': return 'IELTS Speaking Part 1 Practice';
    case 'part2': return 'IELTS Speaking Part 2 Practice';
    case 'part3': return 'IELTS Speaking Part 3 Practice';
    case 'full': return 'IELTS Speaking Full Test';
    default: return 'IELTS Speaking Practice';
  }
}

function safeFilePart(value: string): string {
  return asciiText(value)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'Candidate';
}

export const FeedbackPdfService = {
  createFeedbackPdf({ evaluation, session, candidateName }: FeedbackPdfInput): Blob {
    const pages: PdfCommand[][] = [];
    let currentPage: PdfCommand[] = [];
    let y = TOP_Y;

    const startPage = () => {
      currentPage = [];
      pages.push(currentPage);
      currentPage.push('0.16 0.18 0.42 rg 0 812 595 30 re f');
      currentPage.push('0.86 0.13 0.20 rg 0 806 595 6 re f');
      currentPage.push('BT /F2 10 Tf 1 1 1 rg 1 0 0 1 48 823 Tm (HEXA\'S EDUCATION | IELTS SPEAKING PRACTICE) Tj ET');
      y = TOP_Y;
    };

    const ensureSpace = (height: number) => {
      if (y - height < BOTTOM_Y) startPage();
    };

    const gap = (amount = 8) => {
      y -= amount;
    };

    const addLine = (text: unknown, size = 10, bold = false, indent = 0, muted = false) => {
      ensureSpace(size + 7);
      currentPage.push(muted
        ? mutedTextCommand(text, MARGIN_X + indent, y, size)
        : textCommand(text, MARGIN_X + indent, y, size, bold));
      y -= size + 5;
    };

    const addParagraph = (text: unknown, size = 10, indent = 0, muted = false) => {
      const lines = wrapText(text, size, CONTENT_WIDTH - indent);
      if (lines.length === 0) return;
      for (const line of lines) addLine(line, size, false, indent, muted);
      gap(4);
    };

    const addHeading = (title: string) => {
      ensureSpace(34);
      gap(7);
      currentPage.push('0.94 0.95 0.98 rg 46 ' + (y - 8).toFixed(1) + ' 503 25 re f');
      addLine(title, 12, true, 6);
      gap(5);
    };

    const addBulletList = (items: string[] | undefined, fallback?: string) => {
      const values = items && items.length > 0 ? items : (fallback ? [fallback] : []);
      values.forEach((item) => {
        const lines = wrapText(item, 10, CONTENT_WIDTH - 18);
        if (!lines.length) return;
        ensureSpace(lines.length * 15 + 2);
        addLine(`- ${lines[0]}`, 10, false, 8);
        for (let i = 1; i < lines.length; i += 1) addLine(`  ${lines[i]}`, 10, false, 8);
        gap(1);
      });
    };

    startPage();

    addLine('IELTS SPEAKING FEEDBACK REPORT', 20, true);
    addLine('Detailed practice assessment generated from the saved session evaluation', 9, false, 0, true);
    gap(8);

    const reportDate = new Date(evaluation.createdAt || session.createdAt || Date.now());
    addLine(`Candidate: ${candidateName || 'IELTS Candidate'}`, 10, true);
    addLine(`Test: ${testLabel(session)}`, 10);
    addLine(`Topic: ${session.topic || 'IELTS Speaking Practice'}`, 10);
    addLine(`Report date: ${reportDate.toLocaleDateString('en-GB')}`, 10);
    addLine(`Session ID: ${session.id}`, 8, false, 0, true);

    addHeading('Overall Practice Band');
    addLine(`Estimated Overall Band: ${evaluation.estimatedOverallBand.toFixed(1)}`, 18, true);
    if (evaluation.bandRange) addLine(`Estimated range: ${evaluation.bandRange}`, 10);
    if (typeof evaluation.confidence === 'number') addLine(`AI confidence: ${Math.round(evaluation.confidence * 100)}%`, 10);
    addParagraph(evaluation.disclaimer || 'Estimated practice assessment only. This is not an official IELTS result.', 9, 0, true);

    addHeading('Four IELTS Speaking Criteria');
    const pronunciation = evaluation.criteria.pronunciation;
    const pronunciationLabel = pronunciation.status === 'not_assessed'
      ? 'Not assessed'
      : `${pronunciation.score.toFixed(1)}${pronunciation.status === 'assumed' ? ' (assumed)' : ''}`;

    addLine(`Fluency & Coherence: ${evaluation.criteria.fluencyAndCoherence.score.toFixed(1)}`, 11, true);
    addParagraph(evaluation.criteria.fluencyAndCoherence.feedback);
    addLine(`Lexical Resource: ${evaluation.criteria.lexicalResource.score.toFixed(1)}`, 11, true);
    addParagraph(evaluation.criteria.lexicalResource.feedback);
    addLine(`Grammatical Range & Accuracy: ${evaluation.criteria.grammaticalRangeAccuracy.score.toFixed(1)}`, 11, true);
    addParagraph(evaluation.criteria.grammaticalRangeAccuracy.feedback);
    addLine(`Pronunciation: ${pronunciationLabel}`, 11, true);
    addParagraph(pronunciation.feedback || 'Pronunciation feedback was not available for this report.');

    addHeading('Examiner Summary');
    addParagraph(evaluation.examinerNote);

    addHeading('Strengths');
    addBulletList(evaluation.strengths, 'No separate strengths were returned by the evaluator.');

    addHeading('Highest-Priority Improvements');
    addBulletList(evaluation.priorities, 'Continue targeted speaking practice using the criterion feedback above.');

    if (evaluation.partFeedback?.length) {
      addHeading('Part-by-Part Feedback');
      evaluation.partFeedback.forEach((part) => {
        ensureSpace(48);
        addLine(part.part, 12, true);
        addParagraph(part.summary);
        addLine('What worked', 10, true);
        addBulletList(part.strengths, 'No separate strength was identified for this part.');
        addLine('Improve next', 10, true);
        addBulletList(part.improvements, 'No separate improvement was identified for this part.');
        if (part.evidence?.length) {
          addLine('Evidence from your answers', 10, true);
          addBulletList(part.evidence);
        }
        gap(6);
      });
    }

    if (evaluation.criteria.grammaticalRangeAccuracy.corrections.length > 0) {
      addHeading('Grammar Corrections');
      evaluation.criteria.grammaticalRangeAccuracy.corrections.forEach((correction, index) => {
        addLine(`${index + 1}. Original: ${correction.incorrect}`, 10, true);
        addParagraph(`Better: ${correction.correct}`);
        addParagraph(`Why: ${correction.ruleExplanation}`, 9, 0, true);
      });
    }

    if (evaluation.criteria.lexicalResource.improvedPhrases.length > 0) {
      addHeading('Vocabulary & Collocation Upgrades');
      evaluation.criteria.lexicalResource.improvedPhrases.forEach((phrase, index) => {
        addLine(`${index + 1}. Original: ${phrase.original}`, 10, true);
        addParagraph(`Upgrade: ${phrase.improved}`);
        addParagraph(`Why: ${phrase.explanation}`, 9, 0, true);
      });
    }

    if (pronunciation.problemWords?.length) {
      addHeading('Pronunciation Focus Words');
      addParagraph(pronunciation.problemWords.join(', '));
    }

    if (evaluation.evidence?.length) {
      addHeading('Verified Transcript Evidence');
      addBulletList(evaluation.evidence);
    }

    addHeading('7-Day Practice Action Plan');
    addBulletList(evaluation.actionPlan, 'Review the criterion feedback and repeat the test after targeted practice.');

    const candidateTurns = (session.transcript || []).filter((turn) => turn.speaker === 'candidate' && turn.text?.trim());
    if (candidateTurns.length > 0) {
      addHeading('Candidate Response Transcript');
      candidateTurns.forEach((turn, index) => {
        addLine(`Response ${index + 1}`, 9, true);
        addParagraph(turn.text, 9);
      });
    }

    addHeading('Assessment Note');
    addParagraph('This PDF is generated from the evaluation already saved for this practice session. Downloading it does not run a new AI evaluation and does not consume an additional test credit.', 9);
    addParagraph('HEXA\'S EDUCATION - IELTS Speaking Practice', 9, 0, true);

    pages.forEach((page, index) => {
      page.push(mutedTextCommand(`Page ${index + 1} of ${pages.length}`, 482, 28, 8));
      page.push(mutedTextCommand('Hexa\'s Education', 48, 28, 8));
    });

    return buildPdf(pages);
  },

  downloadFeedbackReport(input: FeedbackPdfInput): void {
    const blob = this.createFeedbackPdf(input);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date(input.evaluation.createdAt || input.session.createdAt || Date.now()).toISOString().slice(0, 10);
    link.href = url;
    link.download = `Hexas_Education_IELTS_Feedback_${safeFilePart(input.candidateName || 'Candidate')}_${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
