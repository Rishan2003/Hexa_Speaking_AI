import type { IELTSEvaluation, IELTSPracticeSession, IELTSProblemDiagnostic } from '../types';

interface FeedbackPdfInput {
  evaluation: IELTSEvaluation;
  session: IELTSPracticeSession;
  candidateName?: string | null;
}

type PdfCommand = string;
type RGB = [number, number, number];

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 38;
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

function wrapText(value: unknown, fontSize = 8.5, width = CONTENT_WIDTH, maxLines = 2): string[] {
  const text = asciiText(value);
  if (!text) return [];

  const maxChars = Math.max(16, Math.floor(width / Math.max(4.3, fontSize * 0.49)));
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

  if (lines.length === maxLines && lines.join(' ').length < text.length - 1) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1], Math.max(12, maxChars - 1));
  }

  return lines;
}

function textCommand(
  text: unknown,
  x: number,
  y: number,
  size: number,
  bold = false,
  color: RGB = [0.12, 0.15, 0.20],
): PdfCommand {
  const font = bold ? '/F2' : '/F1';
  const [r, g, b] = color;
  return `BT ${font} ${size} Tf ${r} ${g} ${b} rg 1 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)} Tm (${escapePdfText(text)}) Tj ET`;
}

function rectCommand(x: number, y: number, width: number, height: number, color: RGB): PdfCommand {
  const [r, g, b] = color;
  return `${r} ${g} ${b} rg ${x.toFixed(1)} ${y.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)} re f`;
}

function lineCommand(x1: number, y1: number, x2: number, y2: number, color: RGB = [0.88, 0.89, 0.92]): PdfCommand {
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

  let pdf = '%PDF-1.4\n% Hexa Education One Page Diagnostic Feedback\n';
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

function firstNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    const text = asciiText(value);
    if (text) return text;
  }
  return '';
}

function deriveFallbackDiagnostics(evaluation: IELTSEvaluation): IELTSProblemDiagnostic[] {
  const diagnostics: IELTSProblemDiagnostic[] = [];
  const grammar = evaluation.criteria.grammaticalRangeAccuracy.corrections?.[0];
  const lexical = evaluation.criteria.lexicalResource.improvedPhrases?.[0];
  const fluencyExample = evaluation.criteria.fluencyAndCoherence.examples?.[0];

  if (grammar) {
    diagnostics.push({
      area: 'Grammar',
      label: 'Grammar accuracy pattern',
      severity: 'high',
      evidence: grammar.incorrect,
      explanation: grammar.ruleExplanation || evaluation.criteria.grammaticalRangeAccuracy.feedback,
      howToImprove: `Use the corrected form: ${grammar.correct}`,
      practiceDrill: 'Make 8 new spoken sentences with this same grammar pattern, then repeat them without reading.',
    });
  }

  if (lexical) {
    diagnostics.push({
      area: 'Lexical Resource',
      label: 'Lexical precision / collocation',
      severity: 'medium',
      evidence: lexical.original,
      explanation: lexical.explanation || evaluation.criteria.lexicalResource.feedback,
      howToImprove: `Replace it naturally with: ${lexical.improved}`,
      practiceDrill: 'Create 5 short IELTS answers using the improved phrase naturally in different contexts.',
    });
  }

  if (fluencyExample || evaluation.criteria.fluencyAndCoherence.feedback) {
    diagnostics.push({
      area: 'Fluency & Coherence',
      label: 'Answer development / coherence',
      severity: 'medium',
      evidence: fluencyExample || 'Pattern identified across the candidate answers.',
      explanation: evaluation.criteria.fluencyAndCoherence.feedback,
      howToImprove: 'Build answers with Point -> Reason -> Example instead of stopping after the first idea.',
      practiceDrill: 'Answer 3 questions for 45-60 seconds each and include one reason plus one example every time.',
    });
  }

  return diagnostics.slice(0, 3);
}

export const FeedbackPdfService = {
  createFeedbackPdf({ evaluation, session, candidateName }: FeedbackPdfInput): Blob {
    const commands: PdfCommand[] = [];

    const navy: RGB = [0.12, 0.14, 0.36];
    const red: RGB = [0.86, 0.13, 0.20];
    const soft: RGB = [0.96, 0.97, 0.99];
    const muted: RGB = [0.40, 0.43, 0.49];
    const greenSoft: RGB = [0.94, 0.98, 0.95];
    const amberSoft: RGB = [1.00, 0.98, 0.92];
    const blueSoft: RGB = [0.94, 0.96, 1.00];

    const addWrapped = (
      value: unknown,
      x: number,
      y: number,
      width: number,
      size = 8.2,
      maxLines = 2,
      color: RGB = [0.12, 0.15, 0.20],
      bold = false,
      lineHeight = 10.2,
    ) => {
      const lines = wrapText(value, size, width, maxLines);
      lines.forEach((line, index) => {
        commands.push(textCommand(line, x, y - index * lineHeight, size, bold, color));
      });
      return lines.length;
    };

    // Header
    commands.push(rectCommand(0, 798, PAGE_WIDTH, 44, navy));
    commands.push(rectCommand(0, 792, PAGE_WIDTH, 6, red));
    commands.push(textCommand("HEXA'S EDUCATION", MARGIN_X, 817, 12, true, [1, 1, 1]));
    commands.push(textCommand('IELTS SPEAKING - ONE PAGE DIAGNOSTIC FEEDBACK', 260, 817, 9.2, true, [1, 1, 1]));

    // Identity + overall band
    const reportDate = new Date(evaluation.createdAt || session.createdAt || Date.now());
    const identity = `${candidateName || 'IELTS Candidate'}  |  ${testLabel(session)}  |  ${reportDate.toLocaleDateString('en-GB')}`;
    commands.push(textCommand('Performance Diagnosis', MARGIN_X, 765, 18, true, navy));
    commands.push(textCommand(truncate(identity, 90), MARGIN_X, 746, 8.3, true));
    commands.push(textCommand('Overall estimated band', 424, 765, 7.5, true, muted));
    commands.push(textCommand(evaluation.estimatedOverallBand.toFixed(1), 507, 742, 24, true, navy));
    commands.push(lineCommand(MARGIN_X, 729, PAGE_WIDTH - MARGIN_X, 729));

    // 4 criterion score strip
    const criterionScores = [
      ['Fluency', scoreText(evaluation.criteria.fluencyAndCoherence.score)],
      ['Lexical', scoreText(evaluation.criteria.lexicalResource.score)],
      ['Grammar', scoreText(evaluation.criteria.grammaticalRangeAccuracy.score)],
      ['Pronunciation*', scoreText(evaluation.criteria.pronunciation.score)],
    ] as const;
    const scoreGap = 7;
    const scoreWidth = (CONTENT_WIDTH - scoreGap * 3) / 4;
    criterionScores.forEach(([label, score], index) => {
      const x = MARGIN_X + index * (scoreWidth + scoreGap);
      commands.push(rectCommand(x, 674, scoreWidth, 42, soft));
      commands.push(textCommand(label, x + 9, 701, 7.3, true, muted));
      commands.push(textCommand(score, x + 9, 682, 15, true, navy));
    });

    commands.push(textCommand('4 CRITERIA FEEDBACK + EXAMPLE', MARGIN_X, 654, 9, true, navy));

    const grammarExample = evaluation.criteria.grammaticalRangeAccuracy.corrections?.[0];
    const lexicalExample = evaluation.criteria.lexicalResource.improvedPhrases?.[0];
    const fluencyExample = evaluation.criteria.fluencyAndCoherence.examples?.[0];

    const criterionRows = [
      {
        label: 'Fluency & Coherence',
        score: scoreText(evaluation.criteria.fluencyAndCoherence.score),
        feedback: evaluation.criteria.fluencyAndCoherence.feedback,
        example: fluencyExample ? `Example: "${fluencyExample}"` : 'Example: No short evidence example was returned.',
      },
      {
        label: 'Lexical Resource',
        score: scoreText(evaluation.criteria.lexicalResource.score),
        feedback: evaluation.criteria.lexicalResource.feedback,
        example: lexicalExample
          ? `Example: "${lexicalExample.original}" -> "${lexicalExample.improved}"`
          : 'Example: No defensible lexical replacement was identified.',
      },
      {
        label: 'Grammar Range & Accuracy',
        score: scoreText(evaluation.criteria.grammaticalRangeAccuracy.score),
        feedback: evaluation.criteria.grammaticalRangeAccuracy.feedback,
        example: grammarExample
          ? `Example: "${grammarExample.incorrect}" -> "${grammarExample.correct}"`
          : 'Example: No defensible grammar correction was identified.',
      },
      {
        label: 'Pronunciation',
        score: scoreText(evaluation.criteria.pronunciation.score),
        feedback: evaluation.criteria.pronunciation.feedback,
        example: evaluation.criteria.pronunciation.status === 'assumed'
          ? 'Example: Audio analysis is off, so no pronunciation example is claimed.'
          : firstNonEmpty(evaluation.criteria.pronunciation.problemWords?.[0], 'No pronunciation problem word was identified.'),
      },
    ];

    const rowHeight = 56;
    const rowStartY = 590;
    criterionRows.forEach((row, index) => {
      const y = rowStartY - index * rowHeight;
      const fill = index % 2 === 0 ? blueSoft : soft;
      commands.push(rectCommand(MARGIN_X, y, CONTENT_WIDTH, rowHeight - 5, fill));
      commands.push(textCommand(row.label, MARGIN_X + 10, y + 34, 8.2, true, navy));
      commands.push(textCommand(`Band ${row.score}`, MARGIN_X + 10, y + 18, 8.0, true, red));
      addWrapped(row.feedback, MARGIN_X + 128, y + 35, CONTENT_WIDTH - 140, 7.8, 2, undefined, false, 9.2);
      addWrapped(row.example, MARGIN_X + 128, y + 12, CONTENT_WIDTH - 140, 7.2, 1, muted, false, 8.5);
    });

    // Specific problem detection and practical repair
    commands.push(textCommand('SPECIFIC PROBLEMS DETECTED -> HOW TO FIX THEM', MARGIN_X, 355, 9, true, navy));
    commands.push(textCommand('Only the highest-impact patterns are shown; examples stay short and evidence-based.', MARGIN_X, 340, 7.4, false, muted));

    const structured = (evaluation.problemDiagnostics || []).filter((item) => item?.label && item?.howToImprove && item?.practiceDrill);
    const diagnostics = (structured.length ? structured : deriveFallbackDiagnostics(evaluation)).slice(0, 3);
    const diagnosticFills = [amberSoft, greenSoft, soft];
    const problemHeight = 78;
    const problemStartY = 248;

    diagnostics.forEach((problem, index) => {
      const y = problemStartY - index * problemHeight;
      commands.push(rectCommand(MARGIN_X, y, CONTENT_WIDTH, problemHeight - 7, diagnosticFills[index] || soft));
      commands.push(textCommand(`${index + 1}. ${truncate(problem.label, 36)}`, MARGIN_X + 10, y + 54, 8.5, true, navy));
      const severity = String(problem.severity || 'medium').toUpperCase();
      commands.push(textCommand(`${problem.area} | ${severity}`, MARGIN_X + 350, y + 54, 7.0, true, red));

      commands.push(textCommand('Evidence:', MARGIN_X + 10, y + 38, 7.2, true, muted));
      addWrapped(problem.evidence, MARGIN_X + 58, y + 38, CONTENT_WIDTH - 70, 7.4, 1, undefined, false, 8.5);

      commands.push(textCommand('Fix:', MARGIN_X + 10, y + 23, 7.2, true, muted));
      addWrapped(problem.howToImprove, MARGIN_X + 58, y + 23, CONTENT_WIDTH - 70, 7.4, 1, undefined, false, 8.5);

      commands.push(textCommand('Drill:', MARGIN_X + 10, y + 8, 7.2, true, muted));
      addWrapped(problem.practiceDrill, MARGIN_X + 58, y + 8, CONTENT_WIDTH - 70, 7.4, 1, undefined, false, 8.5);
    });

    if (!diagnostics.length) {
      commands.push(rectCommand(MARGIN_X, 170, CONTENT_WIDTH, 70, soft));
      addWrapped('No reliable recurring problem pattern was returned. Re-evaluate the completed test to generate structured diagnostic targets.', MARGIN_X + 12, 212, CONTENT_WIDTH - 24, 8.0, 3);
    }

    // Footer
    commands.push(lineCommand(MARGIN_X, 55, PAGE_WIDTH - MARGIN_X, 55));
    commands.push(textCommand('* Pronunciation is currently assumed at Band 6.0; it is not audio-assessed.', MARGIN_X, 39, 6.9, false, muted));
    commands.push(textCommand('Practice estimate only - not an official IELTS result.', MARGIN_X, 27, 6.9, false, muted));
    commands.push(textCommand("Hexa's Education", 474, 27, 7.0, true, navy));

    return buildPdf(commands);
  },

  downloadFeedbackReport(input: FeedbackPdfInput): void {
    const blob = this.createFeedbackPdf(input);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date(input.evaluation.createdAt || input.session.createdAt || Date.now()).toISOString().slice(0, 10);
    link.href = url;
    link.download = `Hexas_Education_IELTS_Diagnostic_Feedback_${safeFilePart(input.candidateName || 'Candidate')}_${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
