import type { IELTSEvaluation, IELTSPracticeSession } from '../types';

interface FeedbackPdfInput {
  evaluation: IELTSEvaluation;
  session: IELTSPracticeSession;
  candidateName?: string | null;
}

type PdfCommand = string;

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 42;
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

function truncate(value: unknown, maxChars: number): string {
  const text = asciiText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function wrapText(value: unknown, fontSize = 9, width = CONTENT_WIDTH, maxLines = 3): string[] {
  const text = asciiText(value);
  if (!text) return [];

  const maxChars = Math.max(15, Math.floor(width / Math.max(4.5, fontSize * 0.5)));
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) lines.push(current);
    current = word;

    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length > maxLines) lines.length = maxLines;
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').length;
    if (consumed < text.length - 1) {
      lines[maxLines - 1] = truncate(lines[maxLines - 1], Math.max(12, maxChars - 1));
    }
  }

  return lines;
}

function textCommand(
  text: unknown,
  x: number,
  y: number,
  size: number,
  bold = false,
  color: [number, number, number] = [0.12, 0.15, 0.20],
): PdfCommand {
  const font = bold ? '/F2' : '/F1';
  const [r, g, b] = color;
  return `BT ${font} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET`;
}

function rectCommand(x: number, y: number, width: number, height: number, color: [number, number, number]): PdfCommand {
  const [r, g, b] = color;
  return `${r} ${g} ${b} rg ${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)} re f`;
}

function lineCommand(x1: number, y1: number, x2: number, y2: number, color: [number, number, number] = [0.88, 0.89, 0.92]): PdfCommand {
  const [r, g, b] = color;
  return `${r} ${g} ${b} RG 0.7 w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S`;
}

function buildPdf(commands: PdfCommand[]): Blob {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [5 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';

  const stream = commands.join('\n');
  objects[5] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>`;
  objects[6] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;

  let pdf = '%PDF-1.4\n% Hexa Education One Page Feedback\n';
  const offsets: number[] = [0];

  for (let index = 1; index <= 6; index += 1) {
    offsets[index] = pdf.length;
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = pdf.length;
  pdf += 'xref\n0 7\n';
  pdf += '0000000000 65535 f \n';
  for (let index = 1; index <= 6; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

function testLabel(session: IELTSPracticeSession): string {
  switch (session.selectedTestSnapshot?.mode) {
    case 'part1': return 'Speaking Part 1';
    case 'part2': return 'Speaking Part 2';
    case 'part3': return 'Speaking Part 3';
    case 'full': return 'Speaking Full Test';
    default: return 'Speaking Practice';
  }
}

function safeFilePart(value: string): string {
  return asciiText(value)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'Candidate';
}

function scoreText(score: number | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) && score > 0 ? score.toFixed(1) : 'N/A';
}

function topItems(items: string[] | undefined, count: number, fallback: string): string[] {
  const cleaned = (items || []).map((item) => asciiText(item)).filter(Boolean);
  if (cleaned.length === 0) return [fallback];
  return cleaned.slice(0, count);
}

export const FeedbackPdfService = {
  createFeedbackPdf({ evaluation, session, candidateName }: FeedbackPdfInput): Blob {
    const commands: PdfCommand[] = [];
    const navy: [number, number, number] = [0.12, 0.14, 0.36];
    const red: [number, number, number] = [0.86, 0.13, 0.20];
    const soft: [number, number, number] = [0.96, 0.97, 0.99];
    const muted: [number, number, number] = [0.40, 0.43, 0.49];
    const greenSoft: [number, number, number] = [0.94, 0.98, 0.95];
    const amberSoft: [number, number, number] = [1.00, 0.98, 0.92];

    const addWrapped = (
      value: unknown,
      x: number,
      y: number,
      width: number,
      size = 8.5,
      maxLines = 3,
      color: [number, number, number] = [0.12, 0.15, 0.20],
      bold = false,
      lineHeight = 11,
    ) => {
      const lines = wrapText(value, size, width, maxLines);
      lines.forEach((line, index) => {
        commands.push(textCommand(line, x, y - index * lineHeight, size, bold, color));
      });
      return lines.length;
    };

    const addBullets = (
      items: string[],
      x: number,
      y: number,
      width: number,
      maxItems = 3,
      maxLinesPerItem = 2,
      size = 8.2,
      lineHeight = 10.5,
      itemGap = 4,
    ) => {
      let cursorY = y;
      items.slice(0, maxItems).forEach((item) => {
        commands.push(textCommand('-', x, cursorY, size + 1, true, navy));
        const lines = wrapText(item, size, width - 13, maxLinesPerItem);
        lines.forEach((line, index) => {
          commands.push(textCommand(line, x + 12, cursorY - index * lineHeight, size));
        });
        cursorY -= Math.max(1, lines.length) * lineHeight + itemGap;
      });
      return cursorY;
    };

    // Brand header
    commands.push(rectCommand(0, 798, PAGE_WIDTH, 44, navy));
    commands.push(rectCommand(0, 792, PAGE_WIDTH, 6, red));
    commands.push(textCommand("HEXA'S EDUCATION", MARGIN_X, 817, 12, true, [1, 1, 1]));
    commands.push(textCommand('IELTS SPEAKING - ONE PAGE FEEDBACK', 292, 817, 9.5, true, [1, 1, 1]));

    // Title / identity
    commands.push(textCommand('Your Speaking Snapshot', MARGIN_X, 764, 19, true, navy));
    commands.push(textCommand('Focused feedback. No transcript. Only what to improve next.', MARGIN_X, 747, 9, false, muted));

    const reportDate = new Date(evaluation.createdAt || session.createdAt || Date.now());
    const identity = `${candidateName || 'IELTS Candidate'}  |  ${testLabel(session)}  |  ${reportDate.toLocaleDateString('en-GB')}`;
    commands.push(textCommand(truncate(identity, 92), MARGIN_X, 727, 8.5, true));
    commands.push(lineCommand(MARGIN_X, 717, PAGE_WIDTH - MARGIN_X, 717));

    // Overall band + criteria row
    commands.push(rectCommand(MARGIN_X, 622, 126, 78, navy));
    commands.push(textCommand('ESTIMATED BAND', MARGIN_X + 14, 681, 8.5, true, [0.86, 0.88, 0.95]));
    commands.push(textCommand(evaluation.estimatedOverallBand.toFixed(1), MARGIN_X + 14, 642, 32, true, [1, 1, 1]));
    if (evaluation.bandRange) {
      commands.push(textCommand(`Range ${truncate(evaluation.bandRange, 18)}`, MARGIN_X + 67, 647, 8, false, [0.90, 0.91, 0.96]));
    }

    const criteria = [
      ['Fluency', scoreText(evaluation.criteria.fluencyAndCoherence.score)],
      ['Vocabulary', scoreText(evaluation.criteria.lexicalResource.score)],
      ['Grammar', scoreText(evaluation.criteria.grammaticalRangeAccuracy.score)],
      ['Pronunciation', scoreText(evaluation.criteria.pronunciation.status === 'not_assessed' ? undefined : evaluation.criteria.pronunciation.score)],
    ] as const;

    const cardX = MARGIN_X + 138;
    const cardGap = 7;
    const cardWidth = (CONTENT_WIDTH - 138 - cardGap * 3) / 4;
    criteria.forEach(([label, score], index) => {
      const x = cardX + index * (cardWidth + cardGap);
      commands.push(rectCommand(x, 622, cardWidth, 78, soft));
      commands.push(textCommand(label, x + 9, 679, 7.5, true, muted));
      commands.push(textCommand(score, x + 9, 647, 20, true, navy));
      commands.push(textCommand('Band', x + 9, 631, 7, false, muted));
    });

    // Examiner snapshot
    commands.push(textCommand('EXAMINER SNAPSHOT', MARGIN_X, 596, 9, true, navy));
    addWrapped(evaluation.examinerNote || evaluation.disclaimer || 'Keep practicing with clear, developed answers.', MARGIN_X, 579, CONTENT_WIDTH, 9, 3, [0.16, 0.18, 0.23], false, 11.5);

    // Strengths / priorities two-column block
    const columnGap = 14;
    const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
    const leftX = MARGIN_X;
    const rightX = MARGIN_X + columnWidth + columnGap;
    commands.push(rectCommand(leftX, 380, columnWidth, 142, greenSoft));
    commands.push(rectCommand(rightX, 380, columnWidth, 142, amberSoft));
    commands.push(textCommand('WHAT YOU ARE DOING WELL', leftX + 14, 500, 9, true, navy));
    commands.push(textCommand('BIGGEST IMPROVEMENTS', rightX + 14, 500, 9, true, navy));

    const strengths = topItems(evaluation.strengths, 3, 'You completed the speaking practice and produced assessable responses.');
    const priorities = topItems(evaluation.priorities, 3, 'Develop answers more clearly and review the criterion feedback.');
    addBullets(strengths, leftX + 14, 478, columnWidth - 28, 3, 2);
    addBullets(priorities, rightX + 14, 478, columnWidth - 28, 3, 2);

    // Precision fixes
    commands.push(textCommand('FASTEST SCORE-BUILDING FIXES', MARGIN_X, 351, 9, true, navy));
    commands.push(lineCommand(MARGIN_X, 343, PAGE_WIDTH - MARGIN_X, 343));

    const grammarFix = evaluation.criteria.grammaticalRangeAccuracy.corrections?.[0];
    const vocabFix = evaluation.criteria.lexicalResource.improvedPhrases?.[0];
    const problemWord = evaluation.criteria.pronunciation.problemWords?.[0];

    let fastY = 325;
    if (grammarFix) {
      commands.push(textCommand('Grammar', MARGIN_X, fastY, 8, true, red));
      addWrapped(`${grammarFix.incorrect}  ->  ${grammarFix.correct}`, MARGIN_X + 72, fastY, CONTENT_WIDTH - 72, 8.3, 2, undefined, false, 10.5);
      fastY -= 29;
    }
    if (vocabFix) {
      commands.push(textCommand('Vocabulary', MARGIN_X, fastY, 8, true, red));
      addWrapped(`${vocabFix.original}  ->  ${vocabFix.improved}`, MARGIN_X + 72, fastY, CONTENT_WIDTH - 72, 8.3, 2, undefined, false, 10.5);
      fastY -= 29;
    }
    if (problemWord && fastY >= 260) {
      commands.push(textCommand('Pronunciation', MARGIN_X, fastY, 8, true, red));
      addWrapped(`Focus word: ${problemWord}`, MARGIN_X + 72, fastY, CONTENT_WIDTH - 72, 8.3, 1);
    } else if (!grammarFix && !vocabFix) {
      addWrapped('Use the priorities above as your correction targets in the next practice session.', MARGIN_X, fastY, CONTENT_WIDTH, 8.5, 2);
    }

    // Action plan
    commands.push(rectCommand(MARGIN_X, 101, CONTENT_WIDTH, 128, soft));
    commands.push(textCommand('YOUR NEXT 7 DAYS', MARGIN_X + 14, 207, 9, true, navy));
    commands.push(textCommand('Do these before your next full speaking test:', MARGIN_X + 14, 190, 8.2, false, muted));
    const actionPlan = topItems(evaluation.actionPlan, 3, 'Repeat the speaking test after targeted practice.');
    addBullets(actionPlan, MARGIN_X + 14, 168, CONTENT_WIDTH - 28, 3, 2, 8.2, 10.2, 3);

    // Footer
    commands.push(lineCommand(MARGIN_X, 79, PAGE_WIDTH - MARGIN_X, 79));
    commands.push(textCommand('Practice estimate only - not an official IELTS result.', MARGIN_X, 61, 7.5, false, muted));
    commands.push(textCommand("Hexa's Education", 466, 61, 7.5, true, navy));

    return buildPdf(commands);
  },

  downloadFeedbackReport(input: FeedbackPdfInput): void {
    const blob = this.createFeedbackPdf(input);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date(input.evaluation.createdAt || input.session.createdAt || Date.now()).toISOString().slice(0, 10);
    link.href = url;
    link.download = `Hexas_Education_IELTS_One_Page_Feedback_${safeFilePart(input.candidateName || 'Candidate')}_${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
