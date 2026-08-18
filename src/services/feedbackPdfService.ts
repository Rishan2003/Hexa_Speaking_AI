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

  let pdf = '%PDF-1.4\n% Hexa Education One Page Evidence Feedback\n';
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

function uniqueNonEmpty(values: unknown[], max = 4): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = asciiText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

function deriveFallbackDiagnostics(evaluation: IELTSEvaluation): IELTSProblemDiagnostic[] {
  const diagnostics: IELTSProblemDiagnostic[] = [];
  const grammarCorrections = evaluation.criteria.grammaticalRangeAccuracy.corrections || [];
  const lexicalPhrases = evaluation.criteria.lexicalResource.improvedPhrases || [];
  const fluencyExamples = evaluation.criteria.fluencyAndCoherence.examples || [];

  if (grammarCorrections.length) {
    diagnostics.push({
      area: 'Grammar',
      label: 'Grammar accuracy pattern',
      severity: 'high',
      evidence: grammarCorrections[0].incorrect,
      evidenceExamples: grammarCorrections.slice(0, 3).map((item) => item.incorrect),
      explanation: grammarCorrections[0].ruleExplanation || evaluation.criteria.grammaticalRangeAccuracy.feedback,
      howToImprove: `Use the corrected pattern consistently, e.g. "${grammarCorrections[0].correct}".`,
      practiceDrill: 'Say 8 new sentences using the same corrected pattern, then repeat all 8 without reading.',
    });
  }

  if (lexicalPhrases.length) {
    diagnostics.push({
      area: 'Lexical Resource',
      label: 'Lexical precision / collocation',
      severity: 'medium',
      evidence: lexicalPhrases[0].original,
      evidenceExamples: lexicalPhrases.slice(0, 3).map((item) => item.original),
      explanation: lexicalPhrases[0].explanation || evaluation.criteria.lexicalResource.feedback,
      howToImprove: `Prefer the more natural form "${lexicalPhrases[0].improved}" and reuse it in context.`,
      practiceDrill: 'Build 5 short IELTS answers using the improved phrase naturally in five different contexts.',
    });
  }

  if (fluencyExamples.length || evaluation.criteria.fluencyAndCoherence.feedback) {
    diagnostics.push({
      area: 'Fluency & Coherence',
      label: 'Answer development / coherence',
      severity: 'medium',
      evidence: fluencyExamples[0] || 'Recurring answer-development pattern identified.',
      evidenceExamples: fluencyExamples.slice(0, 3),
      explanation: evaluation.criteria.fluencyAndCoherence.feedback,
      howToImprove: 'Use Point -> Reason -> Example -> Result for answers that need development.',
      practiceDrill: 'Answer 3 questions for 45-60 seconds each; every answer must include one reason and one example.',
    });
  }

  return diagnostics.slice(0, 3);
}

function diagnosticEvidence(problem: IELTSProblemDiagnostic): string[] {
  return uniqueNonEmpty([
    ...(Array.isArray(problem.evidenceExamples) ? problem.evidenceExamples : []),
    problem.evidence,
  ], 3);
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
      size = 8.0,
      maxLines = 2,
      color: RGB = [0.12, 0.15, 0.20],
      bold = false,
      lineHeight = 9.2,
    ) => {
      const lines = wrapText(value, size, width, maxLines);
      lines.forEach((line, index) => {
        commands.push(textCommand(line, x, y - index * lineHeight, size, bold, color));
      });
      return lines.length;
    };

    // Brand header
    commands.push(rectCommand(0, 798, PAGE_WIDTH, 44, navy));
    commands.push(rectCommand(0, 792, PAGE_WIDTH, 6, red));
    commands.push(textCommand("HEXA'S EDUCATION", MARGIN_X, 817, 12, true, [1, 1, 1]));
    commands.push(textCommand('IELTS SPEAKING - ONE PAGE EVIDENCE FEEDBACK', 258, 817, 9.0, true, [1, 1, 1]));

    // Identity + practice estimate
    const reportDate = new Date(evaluation.createdAt || session.createdAt || Date.now());
    const identity = `${candidateName || 'IELTS Candidate'}  |  ${testLabel(session)}  |  ${reportDate.toLocaleDateString('en-GB')}`;
    commands.push(textCommand('Speaking Performance Diagnosis', MARGIN_X, 766, 17, true, navy));
    commands.push(textCommand(truncate(identity, 92), MARGIN_X, 746, 8.2, true));
    commands.push(lineCommand(MARGIN_X, 732, PAGE_WIDTH - MARGIN_X, 732));

    // Overall + three assessed language scores
    const scoreItems = [
      ['Practice estimate', evaluation.estimatedOverallBand.toFixed(1)],
      ['Fluency & Coherence', scoreText(evaluation.criteria.fluencyAndCoherence.score)],
      ['Lexical Resource', scoreText(evaluation.criteria.lexicalResource.score)],
      ['Grammar', scoreText(evaluation.criteria.grammaticalRangeAccuracy.score)],
    ] as const;
    const scoreGap = 7;
    const scoreWidth = (CONTENT_WIDTH - scoreGap * 3) / 4;
    scoreItems.forEach(([label, score], index) => {
      const x = MARGIN_X + index * (scoreWidth + scoreGap);
      commands.push(rectCommand(x, 687, scoreWidth, 34, index === 0 ? blueSoft : soft));
      commands.push(textCommand(label, x + 8, 708, 6.7, true, muted));
      commands.push(textCommand(score, x + 8, 692, 13.5, true, navy));
    });

    commands.push(textCommand('DETAILED CRITERION FEEDBACK + MULTIPLE EVIDENCE EXAMPLES', MARGIN_X, 670, 8.7, true, navy));

    const fluencyExamples = uniqueNonEmpty(evaluation.criteria.fluencyAndCoherence.examples || [], 3);
    const lexicalExamples = (evaluation.criteria.lexicalResource.improvedPhrases || []).slice(0, 3).map((item) =>
      `"${item.original}" -> "${item.improved}"`
    );
    const grammarExamples = (evaluation.criteria.grammaticalRangeAccuracy.corrections || []).slice(0, 3).map((item) =>
      `"${item.incorrect}" -> "${item.correct}"`
    );

    const criterionRows = [
      {
        label: 'Fluency & Coherence',
        score: scoreText(evaluation.criteria.fluencyAndCoherence.score),
        feedback: evaluation.criteria.fluencyAndCoherence.feedback,
        examples: fluencyExamples,
      },
      {
        label: 'Lexical Resource',
        score: scoreText(evaluation.criteria.lexicalResource.score),
        feedback: evaluation.criteria.lexicalResource.feedback,
        examples: lexicalExamples,
      },
      {
        label: 'Grammatical Range & Accuracy',
        score: scoreText(evaluation.criteria.grammaticalRangeAccuracy.score),
        feedback: evaluation.criteria.grammaticalRangeAccuracy.feedback,
        examples: grammarExamples,
      },
    ];

    const criterionBottoms = [570, 470, 370];
    criterionRows.forEach((row, index) => {
      const y = criterionBottoms[index];
      const fill = index === 0 ? blueSoft : index === 1 ? greenSoft : soft;
      commands.push(rectCommand(MARGIN_X, y, CONTENT_WIDTH, 94, fill));
      commands.push(textCommand(row.label, MARGIN_X + 10, y + 75, 8.6, true, navy));
      commands.push(textCommand(`Band ${row.score}`, PAGE_WIDTH - MARGIN_X - 64, y + 75, 8.0, true, red));

      addWrapped(row.feedback, MARGIN_X + 10, y + 58, CONTENT_WIDTH - 20, 7.35, 4, undefined, false, 8.4);

      const evidence = row.examples.length ? row.examples : ['No short defensible example was returned for this criterion.'];
      commands.push(textCommand('Evidence:', MARGIN_X + 10, y + 18, 6.8, true, muted));
      addWrapped(`E1: ${truncate(evidence[0], 120)}`, MARGIN_X + 57, y + 18, CONTENT_WIDTH - 69, 6.65, 1, undefined, false, 7.6);
      if (evidence[1]) {
        addWrapped(`E2: ${truncate(evidence[1], 120)}`, MARGIN_X + 57, y + 7, CONTENT_WIDTH - 69, 6.65, 1, muted, false, 7.6);
      }
    });

    // Recurring problems + repair plan
    commands.push(textCommand('TOP RECURRING PROBLEMS -> EVIDENCE -> FIX -> PRACTICAL DRILL', MARGIN_X, 349, 8.7, true, navy));
    commands.push(textCommand('Only transcript-supported recurring patterns are included.', MARGIN_X, 336, 6.8, false, muted));

    const visibleDiagnosticAreas = new Set(['Fluency & Coherence', 'Lexical Resource', 'Grammar', 'General']);
    const structured = (evaluation.problemDiagnostics || []).filter((item) =>
      item?.label && item?.howToImprove && item?.practiceDrill && visibleDiagnosticAreas.has(String(item?.area))
    );
    const diagnostics = (structured.length ? structured : deriveFallbackDiagnostics(evaluation)).slice(0, 3);
    const problemBottoms = [245, 155, 65];
    const diagnosticFills = [amberSoft, greenSoft, soft];

    diagnostics.forEach((problem, index) => {
      const y = problemBottoms[index];
      commands.push(rectCommand(MARGIN_X, y, CONTENT_WIDTH, 84, diagnosticFills[index] || soft));
      commands.push(textCommand(`${index + 1}. ${truncate(problem.label, 43)}`, MARGIN_X + 10, y + 66, 8.2, true, navy));
      const severity = String(problem.severity || 'medium').toUpperCase();
      commands.push(textCommand(`${problem.area} | ${severity}`, PAGE_WIDTH - MARGIN_X - 145, y + 66, 6.7, true, red));

      const examples = diagnosticEvidence(problem);
      const evidenceText = examples.length
        ? examples.slice(0, 2).map((item, i) => `E${i + 1}: "${truncate(item, 82)}"`).join('   ')
        : `E1: "${truncate(problem.evidence, 82)}"`;
      commands.push(textCommand('Evidence:', MARGIN_X + 10, y + 50, 6.8, true, muted));
      addWrapped(evidenceText, MARGIN_X + 57, y + 50, CONTENT_WIDTH - 69, 6.55, 2, undefined, false, 7.4);

      commands.push(textCommand('Fix:', MARGIN_X + 10, y + 28, 6.8, true, muted));
      addWrapped(problem.howToImprove, MARGIN_X + 57, y + 28, CONTENT_WIDTH - 69, 6.55, 2, undefined, false, 7.2);

      commands.push(textCommand('Drill:', MARGIN_X + 10, y + 12, 6.8, true, muted));
      addWrapped(problem.practiceDrill, MARGIN_X + 57, y + 12, CONTENT_WIDTH - 69, 6.55, 2, undefined, false, 7.2);
    });

    if (!diagnostics.length) {
      commands.push(rectCommand(MARGIN_X, 105, CONTENT_WIDTH, 95, soft));
      addWrapped(
        'No reliable recurring pattern was returned. Re-evaluate the completed test to generate detailed evidence-based targets.',
        MARGIN_X + 12,
        165,
        CONTENT_WIDTH - 24,
        8.0,
        3,
      );
    }

    // Footer
    commands.push(lineCommand(MARGIN_X, 47, PAGE_WIDTH - MARGIN_X, 47));
    commands.push(textCommand('Transcript-based practice feedback - not an official IELTS result.', MARGIN_X, 30, 6.8, false, muted));
    commands.push(textCommand("Hexa's Education", 475, 30, 6.9, true, navy));

    return buildPdf(commands);
  },

  downloadFeedbackReport(input: FeedbackPdfInput): void {
    const blob = this.createFeedbackPdf(input);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date(input.evaluation.createdAt || input.session.createdAt || Date.now()).toISOString().slice(0, 10);
    link.href = url;
    link.download = `Hexas_Education_IELTS_Evidence_Feedback_${safeFilePart(input.candidateName || 'Candidate')}_${date}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
