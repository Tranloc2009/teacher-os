import {
  MATH_SECTION_TITLES,
  type MathQuestion,
  type McqOption,
  type McqOptionLabel,
} from '../../types/mathExam';
import type {
  AdvancedTemplateFamilyConfig,
  BankQuestionRecord,
  GeneratedQuestionVariant,
  GeneratorQuestionStatus,
  ParameterConstraint,
  QuestionTemplateDefinition,
  TemplateCategoryId,
  VariantGenerationOutcome,
  VariantValidationChecklist,
  VariantVerificationProof,
  VerifiedTemplateFamilyId,
} from '../../types/examGenerator';
import { MCQ_LABELS, parseMathContent } from '../mathIntegrity';
import {
  areNumbersEquivalent,
  buildParameterSignature,
  formatMathNumber,
  formatSignedTerm,
  formatViNumber,
  NUMERIC_EPSILON,
  roundToPlaces,
  sampleParameterValue,
  validateConstraintDefinitions,
  validateParameterValues,
} from './parameterConstraintEngine';
import { createSeededRng, type SeededRng } from './seededPrng';
import {
  buildLinearSystemCandidate,
  buildPolynomialDerivativeCandidate,
  buildQuadraticCandidate,
  type AdvancedFamilyCandidate,
  type StructuredOptionCandidate,
} from './advancedMathEngines';
import { canonicalizeMathAnswer } from './verifiedMathCore';
import {
  buildLevel3GraphCandidate,
  isLevel3GraphFamily,
  verifyDynamicGraphBinding,
} from './level3GraphTemplates';

const MAX_GENERATION_ATTEMPTS = 60;
export const GENERATION_FAILED_CONSTRAINTS_MSG =
  'GENERATION FAILED — CONSTRAINTS UNSATISFIED';

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategoryId, string> = {
  'basic-level-1': 'Cơ bản — Level 1',
  'advanced-algebra-level-2': 'Đại số nâng cao — Level 2',
  'calculus-level-2': 'Đạo hàm — Level 2',
  'calculus-graph-level-3': 'Hàm số & Đồ thị — Level 3',
};

export interface TemplateFamilyMeta {
  id: VerifiedTemplateFamilyId;
  category: TemplateCategoryId;
  level: 1 | 2 | 3;
  label: string;
  shortLabel: string;
  subjectHint: string;
  description: string;
  formulaPattern: string;
  defaultUnit?: string;
  defaultDecimalPlaces: number;
  defaultParameters: ParameterConstraint[];
  defaultFamilyConfig?: AdvancedTemplateFamilyConfig;
  defaultStemTemplate: string;
  defaultExplanationTemplate: string;
}

interface ComputedFamilyCandidate {
  params: Record<string, number>;
  answer: number;
  unit?: string;
  decimalPlaces: number;
  stemLatex: string;
  explanationLatex: string;
  independentVerify: (candidateValue: number) => { ok: boolean; proofText: string };
  distractorCandidates: number[];
}

export const VERIFIED_TEMPLATE_FAMILIES: Record<
  VerifiedTemplateFamilyId,
  TemplateFamilyMeta
> = {
  'linear-equation': {
    id: 'linear-equation',
    category: 'basic-level-1',
    level: 1,
    label: 'Phương trình bậc nhất (ax + b = c)',
    shortLabel: 'PT bậc nhất',
    subjectHint: 'Toán học',
    description:
      'Sinh phương trình bậc nhất ax + b = c với a ≠ 0 và nghiệm nguyên x₀ xác định. Kiểm chứng ngược bằng phép thế trực tiếp a·x₀ + b = c.',
    formulaPattern: 'a·x + b = c (a ≠ 0, nghiệm nguyên x₀)',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      {
        name: 'a',
        label: 'Hệ số a (≠ 0)',
        kind: 'integer',
        min: 2,
        max: 9,
        nonZero: true,
        positive: true,
      },
      {
        name: 'x0',
        label: 'Nghiệm đúng x₀',
        kind: 'integer',
        min: -8,
        max: 9,
        nonZero: true,
      },
      {
        name: 'b',
        label: 'Hằng số b',
        kind: 'integer',
        min: -15,
        max: 15,
        nonZero: true,
      },
    ],
    defaultStemTemplate: 'Tìm nghiệm của phương trình ${{a}}x {{bSigned}} = {{c}}$.',
    defaultExplanationTemplate:
      'Chuyển vế ta có ${{a}}x = {{c}} - ({{b}}) = {{rhs}}$, suy ra $x = \\frac{{{rhs}}}{{{a}}} = {{ans}}$. Kiểm tra lại: ${{a}} \\cdot ({{ans}}) {{bSigned}} = {{c}}$ (Đúng).',
  },
  'arithmetic-expression': {
    id: 'arithmetic-expression',
    category: 'basic-level-1',
    level: 1,
    label: 'Biểu thức số học có ngoặc p·(q + r) - s',
    shortLabel: 'Biểu thức số học',
    subjectHint: 'Toán học',
    description:
      'Tính giá trị biểu thức số nguyên có thứ tự thực hiện phép tính. Kiểm chứng độc lập bằng phép khai triển phân phối p·q + p·r - s.',
    formulaPattern: 'A = p·(q + r) - s',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      { name: 'p', label: 'Thừa số p', kind: 'integer', min: 2, max: 9, nonZero: true },
      { name: 'q', label: 'Số hạng q', kind: 'integer', min: 3, max: 15 },
      { name: 'r', label: 'Số hạng r', kind: 'integer', min: -8, max: 12, nonZero: true },
      { name: 's', label: 'Số trừ s', kind: 'integer', min: 1, max: 25, positive: true },
    ],
    defaultStemTemplate: 'Tính giá trị của biểu thức $A = {{p}} \\cdot ({{q}} {{rSigned}}) - {{s}}$.',
    defaultExplanationTemplate:
      'Thực hiện trong ngoặc trước: ${{q}} {{rSigned}} = {{sum}}$. Nhân với ${{p}}$ được ${{prod}}$, rồi trừ ${{s}}$ ta được $A = {{ans}}$. Kiểm chứng khai triển: ${{p}}\\cdot{{q}} + {{p}}\\cdot({{r}}) - {{s}} = {{ans}}$.',
  },
  'algebraic-eval': {
    id: 'algebraic-eval',
    category: 'basic-level-1',
    level: 1,
    label: 'Tính giá trị đa thức P(x) = ax² + bx + c',
    shortLabel: 'Giá trị biểu thức',
    subjectHint: 'Toán học',
    description:
      'Tính giá trị đa thức bậc hai tại điểm x = x₀. Kiểm chứng độc lập bằng lược đồ Horner ((a·x₀ + b)·x₀ + c).',
    formulaPattern: 'P(x) = ax² + bx + c tại x = x₀',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      { name: 'a', label: 'Hệ số a (≠ 0)', kind: 'integer', min: 1, max: 5, nonZero: true },
      { name: 'b', label: 'Hệ số b', kind: 'integer', min: -7, max: 7, nonZero: true },
      { name: 'c', label: 'Hằng số c', kind: 'integer', min: -10, max: 10 },
      { name: 'x0', label: 'Giá trị x₀', kind: 'integer', min: -4, max: 5, nonZero: true },
    ],
    defaultStemTemplate:
      'Cho biểu thức $P(x) = {{a}}x^2 {{bSigned}}x {{cSigned}}$. Giá trị của $P({{x0}})$ bằng bao nhiêu?',
    defaultExplanationTemplate:
      'Thay $x = {{x0}}$ vào biểu thức: $P({{x0}}) = {{a}}\\cdot({{x0}})^2 {{bSigned}}\\cdot({{x0}}) {{cSigned}} = {{ans}}$. Kiểm chứng bằng lược đồ Horner: $({{a}}\\cdot({{x0}}) {{bSigned}})\\cdot({{x0}}) {{cSigned}} = {{ans}}$.',
  },
  'percentage-problem': {
    id: 'percentage-problem',
    category: 'basic-level-1',
    level: 1,
    label: 'Bài toán tỉ lệ phần trăm (tăng/giảm p%)',
    shortLabel: 'Tỉ lệ phần trăm',
    subjectHint: 'Toán học',
    description:
      'Tính giá trị sau khi giảm giá p% từ giá niêm yết gốc (bội số chẵn của 100 để đảm bảo kết quả chính xác tuyệt đối).',
    formulaPattern: 'G_mới = G_gốc · (100 - p) / 100',
    defaultUnit: 'nghìn đồng',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      {
        name: 'baseHundreds',
        label: 'Giá gốc (đơn vị trăm nghìn)',
        kind: 'integer',
        min: 2,
        max: 18,
        positive: true,
      },
      {
        name: 'percent',
        label: 'Mức giảm (%)',
        kind: 'integer',
        min: 5,
        max: 40,
        allowedSet: [5, 10, 15, 20, 25, 30, 35, 40],
      },
    ],
    defaultStemTemplate:
      'Một sản phẩm có giá niêm yết ${{basePrice}}$ nghìn đồng, đang được giảm giá ${{percent}}\\%$. Giá bán sau khi giảm là bao nhiêu?',
    defaultExplanationTemplate:
      'Số tiền được giảm là ${{basePrice}} \\cdot \\frac{{{percent}}}{100} = {{discount}}$ (nghìn đồng). Giá sau khi giảm là ${{basePrice}} - {{discount}} = {{ans}}$ (nghìn đồng). Kiểm chứng: $\\frac{{{ans}}}{{{basePrice}}} = {{remainPercent}}\\%$.',
  },
  'proportion-ratio': {
    id: 'proportion-ratio',
    category: 'basic-level-1',
    level: 1,
    label: 'Bài toán tỉ lệ thức (a / b = x / c)',
    shortLabel: 'Tỉ lệ thức',
    subjectHint: 'Toán học',
    description:
      'Tìm x trong tỉ lệ thức a/b = x/c với mẫu số b > 0 và c = k·b để đảm bảo x là số nguyên chính xác. Kiểm chứng chéo a·c = b·x.',
    formulaPattern: 'a / b = x / c (b > 0, c = k·b)',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      { name: 'a', label: 'Tử số a', kind: 'integer', min: 2, max: 11, positive: true },
      { name: 'b', label: 'Mẫu số b (> 0)', kind: 'integer', min: 2, max: 9, positive: true },
      { name: 'k', label: 'Hệ số tỉ lệ k (c = k·b)', kind: 'integer', min: 2, max: 8, positive: true },
    ],
    defaultStemTemplate:
      'Tìm số thực $x$ thỏa mãn tỉ lệ thức $\\frac{{{a}}}{{{b}}} = \\frac{x}{{{c}}}$.',
    defaultExplanationTemplate:
      'Từ tỉ lệ thức ta có $x = \\frac{{{a}} \\cdot {{c}}}{{{b}}} = {{ans}}$. Kiểm chứng tích chéo: ${{a}} \\cdot {{c}} = {{crossLeft}}$ và ${{b}} \\cdot {{ans}} = {{crossRight}}$ (Bằng nhau).',
  },
  'arithmetic-sequence': {
    id: 'arithmetic-sequence',
    category: 'basic-level-1',
    level: 1,
    label: 'Cấp số cộng (uₙ = u₁ + (n - 1)d)',
    shortLabel: 'Cấp số cộng',
    subjectHint: 'Toán học',
    description:
      'Tìm số hạng thứ n của cấp số cộng biết u₁ và công sai d. Kiểm chứng độc lập bằng phép cộng truy hồi từng bước từ u₁ đến uₙ.',
    formulaPattern: 'uₙ = u₁ + (n - 1)·d',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      { name: 'u1', label: 'Số hạng đầu u₁', kind: 'integer', min: -10, max: 15 },
      { name: 'd', label: 'Công sai d (≠ 0)', kind: 'integer', min: -6, max: 8, nonZero: true },
      { name: 'n', label: 'Chỉ số n (≥ 4)', kind: 'integer', min: 4, max: 15, positive: true },
    ],
    defaultStemTemplate:
      'Cho cấp số cộng $(u_n)$ có số hạng đầu $u_1 = {{u1}}$ và công sai $d = {{d}}$. Giá trị của số hạng $u_{{{n}}}$ bằng:',
    defaultExplanationTemplate:
      'Áp dụng công thức số hạng tổng quát $u_n = u_1 + (n - 1)d$: $u_{{{n}}} = {{u1}} + ({{n}} - 1)\\cdot({{d}}) = {{ans}}$. Kiểm chứng truy hồi đủ ${{n}}$ số hạng đều cho $u_{{{n}}} = {{ans}}$.',
  },
  'physics-motion': {
    id: 'physics-motion',
    category: 'basic-level-1',
    level: 1,
    label: 'Chuyển động thẳng đều (v = s / t)',
    shortLabel: 'Vận tốc v = s/t',
    subjectHint: 'Vật lý',
    description:
      'Tính vận tốc trung bình v = s / t với thời gian t > 0 và đơn vị đồng nhất (km, giờ → km/h). Kiểm chứng ngược s = v · t.',
    formulaPattern: 'v = s / t (t > 0, đơn vị km/h)',
    defaultUnit: 'km/h',
    defaultDecimalPlaces: 0,
    defaultParameters: [
      { name: 'v', label: 'Vận tốc chuẩn v (km/h)', kind: 'integer', min: 20, max: 75, positive: true },
      { name: 't', label: 'Thời gian t (giờ, > 0)', kind: 'integer', min: 2, max: 6, positive: true },
    ],
    defaultStemTemplate:
      'Một ô tô chuyển động thẳng đều đi được quãng đường $s = {{s}}\\text{ km}$ trong thời gian $t = {{t}}\\text{ giờ}$. Tốc độ của ô tô bằng bao nhiêu?',
    defaultExplanationTemplate:
      'Áp dụng công thức $v = \\frac{s}{t} = \\frac{{{s}}}{{{t}}} = {{ans}}\\text{ km/h}$. Kiểm chứng ngược: quãng đường $s = v \\cdot t = {{ans}} \\cdot {{t}} = {{s}}\\text{ km}$ (Khớp đơn vị và giá trị).',
  },
  'quadratic-equation': {
    id: 'quadratic-equation',
    category: 'advanced-algebra-level-2',
    level: 2,
    label: 'Phương trình bậc hai (ax² + bx + c = 0)',
    shortLabel: 'PT bậc hai',
    subjectHint: 'Toán học',
    description:
      'Sinh an toàn từ nghiệm r₁, r₂ và hệ số a ≠ 0 → b = -a(r₁+r₂), c = a·r₁·r₂. Kiểm chứng độc lập bằng biệt thức Δ, thế ngược nghiệm, hệ thức Viète và kiểm tra tương đương tập nghiệm.',
    formulaPattern: 'ax² + bx + c = 0 (a ≠ 0, kiểm chứng Δ & Viète)',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      quadraticMode: 'solution-set',
      rootPolicy: 'distinct',
      maxCoeffMagnitude: 120,
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số a (≠ 0)', kind: 'integer', min: -3, max: 4, nonZero: true },
      { name: 'r1', label: 'Nghiệm thứ nhất r₁', kind: 'integer', min: -6, max: 6 },
      { name: 'r2', label: 'Nghiệm thứ hai r₂', kind: 'integer', min: -6, max: 6 },
    ],
    defaultStemTemplate:
      'Tìm tập nghiệm của phương trình bậc hai $ax^2 + bx + c = 0$ (tự động dựng chuẩn theo nghiệm đã kiểm chứng).',
    defaultExplanationTemplate:
      'Tính biệt thức Δ, giải nghiệm, thế ngược và kiểm chứng hệ thức Viète tự động.',
  },
  'linear-system-2x2': {
    id: 'linear-system-2x2',
    category: 'advanced-algebra-level-2',
    level: 2,
    label: 'Hệ phương trình bậc nhất hai ẩn (2×2)',
    shortLabel: 'Hệ PT 2 ẩn',
    subjectHint: 'Toán học',
    description:
      'Sinh nghiệm duy nhất (x₀, y₀) với ràng buộc định thức D = ad - bc ≠ 0. Giải độc lập bằng cả quy tắc Cramer hữu tỉ và khử Gauss, kiểm chứng thế ngược cả hai phương trình.',
    formulaPattern: 'ax + by = e, cx + dy = f (D = ad - bc ≠ 0)',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      linearSystemMode: 'ordered-pair',
      exprP: 2,
      exprQ: -1,
      maxCoeffMagnitude: 80,
    },
    defaultParameters: [
      { name: 'x0', label: 'Nghiệm x₀', kind: 'integer', min: -5, max: 6 },
      { name: 'y0', label: 'Nghiệm y₀', kind: 'integer', min: -5, max: 6 },
      { name: 'a', label: 'Hệ số a', kind: 'integer', min: -4, max: 5, nonZero: true },
      { name: 'b', label: 'Hệ số b', kind: 'integer', min: -4, max: 5, nonZero: true },
      { name: 'c', label: 'Hệ số c', kind: 'integer', min: -4, max: 5, nonZero: true },
      { name: 'd', label: 'Hệ số d', kind: 'integer', min: -4, max: 5, nonZero: true },
    ],
    defaultStemTemplate:
      'Tìm nghiệm $(x; y)$ của hệ phương trình bậc nhất hai ẩn (tự động dựng từ định thức khác 0).',
    defaultExplanationTemplate:
      'Kiểm tra định thức D ≠ 0, giải Cramer & khử Gauss và thế ngược cả hai phương trình.',
  },
  'polynomial-derivative': {
    id: 'polynomial-derivative',
    category: 'calculus-level-2',
    level: 2,
    label: 'Đạo hàm đa thức bậc 2–4 (f\'(x), f\'(x₀))',
    shortLabel: 'Đạo hàm đa thức',
    subjectHint: 'Toán học',
    description:
      'Sinh đa thức bậc 2–4 dạng mảng hệ số, tính đạo hàm theo quy tắc lũy thừa, chuẩn hóa đa thức, loại bỏ hạng tử hệ số 0 và kiểm chứng độc lập bằng Horner + sai phân phụ.',
    formulaPattern: 'f(x) = aₙxⁿ + … + a₀ → f\'(x) hoặc f\'(x₀)',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      derivativeMode: 'derivative-poly',
      polynomialDegree: 3,
      targetTermDegree: 2,
    },
    defaultParameters: [
      { name: 'a4', label: 'Hệ số bậc 4 (a₄, dùng khi bậc 4)', kind: 'integer', min: -3, max: 4 },
      { name: 'a3', label: 'Hệ số bậc 3 (a₃)', kind: 'integer', min: -5, max: 6 },
      { name: 'a2', label: 'Hệ số bậc 2 (a₂)', kind: 'integer', min: -6, max: 6 },
      { name: 'a1', label: 'Hệ số bậc 1 (a₁)', kind: 'integer', min: -8, max: 8 },
      { name: 'a0', label: 'Hằng số tự do (a₀)', kind: 'integer', min: -9, max: 9 },
      { name: 'x0', label: 'Điểm tính đạo hàm x₀', kind: 'integer', min: -3, max: 4 },
    ],
    defaultStemTemplate:
      'Tính đạo hàm của hàm số đa thức $f(x)$ (tự động chuẩn hóa và ẩn hệ số 0).',
    defaultExplanationTemplate:
      'Áp dụng quy tắc đạo hàm từng hạng tử d(axⁿ)/dx = anxⁿ⁻¹ và đạo hàm hằng số bằng 0.',
  },
  // ── PHASE 3: LEVEL 3 DYNAMIC GRAPH & VARIATION TABLE FAMILIES ─────────────
  'quadratic-graph': {
    id: 'quadratic-graph',
    category: 'calculus-graph-level-3',
    level: 3,
    label: 'Hàm số bậc hai & Đồ thị Parabol (f(x) = ax² + bx + c)',
    shortLabel: 'Đồ thị bậc hai',
    subjectHint: 'Toán học',
    description:
      'Sinh hàm bậc hai (a ≠ 0), tính chính xác đạo hàm, tọa độ đỉnh hữu tỷ, khoảng đơn điệu, cực trị, đồ thị SVG và bảng biến thiên đồng bộ.',
    formulaPattern: 'f(x) = ax² + bx + c (a ≠ 0) · Đồ thị + BBT',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      graphFunctionFamily: 'quadratic',
      graphQuestionMode: 'monotonicity-increasing',
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số a (≠ 0)', kind: 'integer', min: -3, max: 3, nonZero: true },
      { name: 'b', label: 'Hệ số b', kind: 'integer', min: -8, max: 8 },
      { name: 'c', label: 'Hằng số c', kind: 'integer', min: -6, max: 6 },
    ],
    defaultStemTemplate:
      'Cho hàm số bậc hai $f(x) = ax^2 + bx + c$ có đồ thị và bảng biến thiên đồng bộ.',
    defaultExplanationTemplate:
      'Tính f\'(x) = 2ax + b, đỉnh I(-b/(2a); f(x₀)), lập bảng biến thiên và kiểm chứng độc lập.',
  },
  'cubic-monotonicity': {
    id: 'cubic-monotonicity',
    category: 'calculus-graph-level-3',
    level: 3,
    label: 'Hàm số bậc ba — Đơn điệu & Đồ thị (ax³ + bx² + cx + d)',
    shortLabel: 'Bậc ba · Đơn điệu',
    subjectHint: 'Toán học',
    description:
      'Sinh hàm bậc ba kiểm soát đầy đủ 3 trường hợp đạo hàm (2 cực trị, nghiệm kép không phải cực trị, vô nghiệm đơn điệu trên ℝ) kèm đồ thị SVG & BBT.',
    formulaPattern: 'f(x) = ax³ + bx² + cx + d (a ≠ 0) · Đơn điệu + Đồ thị',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      graphFunctionFamily: 'cubic',
      graphQuestionMode: 'monotonicity-increasing',
      cubicCasePolicy: 'two-extrema',
      maxCoeffMagnitude: 36,
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số a (≠ 0)', kind: 'integer', min: -2, max: 2, nonZero: true },
      { name: 'x1', label: 'Điểm tới hạn x₁', kind: 'integer', min: -3, max: 1 },
      { name: 'x2', label: 'Điểm tới hạn x₂', kind: 'integer', min: -1, max: 3, uniqueWith: ['x1'] },
      { name: 'd', label: 'Hằng số tự do d', kind: 'integer', min: -4, max: 4 },
    ],
    defaultStemTemplate:
      'Khảo sát tính đơn điệu của hàm số bậc ba $f(x) = ax^3 + bx^2 + cx + d$ kèm đồ thị SVG và bảng biến thiên.',
    defaultExplanationTemplate:
      'Tính f\'(x) = 3ax² + 2bx + c, xét dấu đạo hàm từng khoảng và đối chiếu bảng biến thiên.',
  },
  'cubic-extrema': {
    id: 'cubic-extrema',
    category: 'calculus-graph-level-3',
    level: 3,
    label: 'Hàm số bậc ba — Cực trị & Đọc đồ thị',
    shortLabel: 'Bậc ba · Cực trị',
    subjectHint: 'Toán học',
    description:
      'Sinh hàm bậc ba có đúng 2 cực trị phân biệt (chặn sinh cực trị giả), tính tọa độ & giá trị cực đại/cực tiểu kèm đồ thị SVG đồng bộ.',
    formulaPattern: 'f(x) = ax³ + bx² + cx + d · Cực đại / Cực tiểu',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      graphFunctionFamily: 'cubic',
      graphQuestionMode: 'extrema-value',
      cubicCasePolicy: 'two-extrema',
      maxCoeffMagnitude: 36,
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số a (≠ 0)', kind: 'integer', min: -2, max: 2, nonZero: true },
      { name: 'x1', label: 'Hoành độ cực trị x₁', kind: 'integer', min: -3, max: 1 },
      { name: 'x2', label: 'Hoành độ cực trị x₂', kind: 'integer', min: -1, max: 3, uniqueWith: ['x1'] },
      { name: 'd', label: 'Hằng số tự do d', kind: 'integer', min: -4, max: 4 },
    ],
    defaultStemTemplate:
      'Xác định cực đại, cực tiểu của hàm số bậc ba kèm đồ thị và bảng biến thiên đồng bộ.',
    defaultExplanationTemplate:
      'Giải f\'(x) = 0, kiểm tra đổi dấu hai phía điểm tới hạn và tính tung độ cực trị.',
  },
  'rational-asymptotes': {
    id: 'rational-asymptotes',
    category: 'calculus-graph-level-3',
    level: 3,
    label: 'Hàm phân thức (ax+b)/(cx+d) — Tiệm cận & Đồ thị',
    shortLabel: 'Phân thức · Tiệm cận',
    subjectHint: 'Toán học',
    description:
      'Sinh hàm phân thức (c ≠ 0, ad − bc ≠ 0), tính TCĐ x = −d/c, TCN y = a/c, giới hạn một phía và vẽ 2 nhánh đồ thị tách biệt qua tiệm cận đứng.',
    formulaPattern: 'f(x) = (ax + b)/(cx + d) · TCĐ & TCN',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      graphFunctionFamily: 'rational',
      graphQuestionMode: 'asymptotes',
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số tử a', kind: 'integer', min: -4, max: 4, nonZero: true },
      { name: 'b', label: 'Hằng số tử b', kind: 'integer', min: -6, max: 6 },
      { name: 'c', label: 'Hệ số mẫu c (≠ 0)', kind: 'integer', min: 1, max: 2, positive: true },
      { name: 'd', label: 'Hằng số mẫu d', kind: 'integer', min: -5, max: 5, nonZero: true },
    ],
    defaultStemTemplate:
      'Xác định phương trình tiệm cận đứng và tiệm cận ngang của đồ thị hàm phân thức.',
    defaultExplanationTemplate:
      'Kiểm tra c ≠ 0, ad − bc ≠ 0; suy ra TCĐ x = −d/c, TCN y = a/c và giới hạn một phía.',
  },
  'rational-monotonicity': {
    id: 'rational-monotonicity',
    category: 'calculus-graph-level-3',
    level: 3,
    label: 'Hàm phân thức (ax+b)/(cx+d) — Đơn điệu trên từng khoảng',
    shortLabel: 'Phân thức · Đơn điệu',
    subjectHint: 'Toán học',
    description:
      'Phân tích dấu đạo hàm f\'(x) = (ad − bc)/(cx + d)² trên từng khoảng xác định tách biệt qua điểm gián đoạn x = −d/c kèm BBT chuẩn.',
    formulaPattern: 'f\'(x) = (ad − bc)/(cx + d)² · Tách 2 miền',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      graphFunctionFamily: 'rational',
      graphQuestionMode: 'monotonicity-increasing',
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số tử a', kind: 'integer', min: -4, max: 4, nonZero: true },
      { name: 'b', label: 'Hằng số tử b', kind: 'integer', min: -6, max: 6 },
      { name: 'c', label: 'Hệ số mẫu c (≠ 0)', kind: 'integer', min: 1, max: 2, positive: true },
      { name: 'd', label: 'Hằng số mẫu d', kind: 'integer', min: -5, max: 5, nonZero: true },
    ],
    defaultStemTemplate:
      'Xác định tính đơn điệu trên từng khoảng xác định của hàm phân thức kèm đồ thị và bảng biến thiên.',
    defaultExplanationTemplate:
      'Tính f\'(x) = (ad − bc)/(cx + d)², lập BBT có hai gạch đứng tại x = −d/c (không gộp khoảng).',
  },
  'graph-variation-table': {
    id: 'graph-variation-table',
    category: 'calculus-graph-level-3',
    level: 3,
    label: 'Nhận diện Đồ thị & Bảng biến thiên (Chọn 1 trong 4 hình)',
    shortLabel: 'Chọn Đồ thị / BBT',
    subjectHint: 'Toán học',
    description:
      'Sinh câu hỏi chọn đồ thị đúng hoặc bảng biến thiên đúng từ 4 phương án SVG của 4 hàm số khác biệt rõ về đặc điểm toán học (di chuyển cùng đáp án khi trộn).',
    formulaPattern: '4 phương án SVG Đồ thị / BBT phân biệt',
    defaultDecimalPlaces: 0,
    defaultFamilyConfig: {
      graphFunctionFamily: 'cubic',
      graphQuestionMode: 'choose-graph',
      cubicCasePolicy: 'two-extrema',
      maxCoeffMagnitude: 36,
    },
    defaultParameters: [
      { name: 'a', label: 'Hệ số a (≠ 0)', kind: 'integer', min: -2, max: 2, nonZero: true },
      { name: 'x1', label: 'Điểm tới hạn x₁', kind: 'integer', min: -2, max: 0 },
      { name: 'x2', label: 'Điểm tới hạn x₂', kind: 'integer', min: 0, max: 2, uniqueWith: ['x1'] },
      { name: 'd', label: 'Hằng số tự do d', kind: 'integer', min: -3, max: 3 },
    ],
    defaultStemTemplate:
      'Chọn đồ thị hoặc bảng biến thiên khớp hoàn toàn với biểu thức hàm số đã cho.',
    defaultExplanationTemplate:
      'Đối chiếu chiều biến thiên, điểm cực trị/tiệm cận và giao điểm trục tung giữa hàm số và 4 hình.',
  },
};

export const VERIFIED_FAMILY_LIST: TemplateFamilyMeta[] = Object.values(
  VERIFIED_TEMPLATE_FAMILIES
);

function interpolateTokens(
  templateText: string,
  tokens: Record<string, string>
): string {
  return templateText.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_match, key: string) => {
    return key in tokens ? tokens[key] : `{{${key}}}`;
  });
}

function formatOptionValue(
  value: number,
  unit?: string,
  decimalPlaces = 0
): string {
  const numStr = formatViNumber(value, decimalPlaces);
  if (unit && unit.trim()) {
    return `$${formatMathNumber(value, decimalPlaces)}\\text{ ${unit.trim()}}$`;
  }
  return `$${numStr}$`;
}

/**
 * Kiểm tra cổng bảo toàn: chặn tuyệt đối đổi số tự động với câu hỏi có hình/đồ thị không cập nhật được
 * hoặc công thức nhị phân OMML / MathType OLE.
 */
export function evaluateBankQuestionVariantSafety(
  record: BankQuestionRecord,
  template?: QuestionTemplateDefinition
): {
  status: GeneratorQuestionStatus;
  canGenerateVariant: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const q = record.question;

  const hasOmmlOrBinary =
    Boolean(record.hasBinaryFormulaOrOmml) ||
    q.stem.blocks.some((b) => b.kind === 'omml-raw' || b.kind === 'mathml') ||
    (q.options ?? []).some((o) =>
      o.content.blocks.some((b) => b.kind === 'omml-raw' || b.kind === 'mathml')
    ) ||
    Boolean(q.sourceVerification?.formulaRiskFlags?.length);

  if (hasOmmlOrBinary) {
    reasons.push(
      'Câu hỏi chứa công thức OMML/MathType nhị phân hoặc dấu hiệu rủi ro công thức — hệ thống khóa tuyệt đối việc tự động đổi số để tránh hỏng XML/toán học.'
    );
  }

  const isDynamicLevel3Linked = Boolean(
    template &&
      template.verifiedTemplate &&
      isLevel3GraphFamily(template.familyId) &&
      !record.hasNonUpdatableVisualAsset
  );

  const hasVisual =
    Boolean(record.hasNonUpdatableVisualAsset) ||
    Boolean(q.hasVisualAsset) ||
    Boolean(q.visualAssets && q.visualAssets.length > 0);

  if (hasVisual && !isDynamicLevel3Linked) {
    reasons.push(
      'Câu hỏi gắn kèm hình ảnh/đồ thị/bảng biến thiên tĩnh không tự cập nhật theo số mới — chỉ được dùng nguyên bản (BLOCKED cho biến thể đổi số).'
    );
  }

  if (reasons.length > 0) {
    return {
      status: 'BLOCKED',
      canGenerateVariant: false,
      reasons,
    };
  }

  if (q.type === 'essay' || q.type === 'true-false') {
    return {
      status: 'UNSUPPORTED',
      canGenerateVariant: false,
      reasons: [
        'Giai đoạn 1 chỉ hỗ trợ biến thể đổi số kiểm chứng cho câu Trắc nghiệm (MCQ) và Trả lời ngắn có mẫu tham số.',
      ],
    };
  }

  if (!template) {
    if (!q.answerConfirmed) {
      return {
        status: 'REVIEW_REQUIRED',
        canGenerateVariant: false,
        reasons: [
          'Câu hỏi gốc chưa được giáo viên xác nhận đáp án (cần rà soát trước khi dùng làm đáp án chuẩn).',
        ],
      };
    }
    return {
      status: 'ORIGINAL',
      canGenerateVariant: false,
      reasons: ['Câu hỏi gốc hợp lệ (chưa gắn mẫu tham số đổi số).'],
    };
  }

  if (!template.verifiedTemplate || !(template.familyId in VERIFIED_TEMPLATE_FAMILIES)) {
    return {
      status: 'UNSUPPORTED',
      canGenerateVariant: false,
      reasons: ['Mẫu tham số chưa nằm trong danh sách Level 1 & Level 2 được kiểm chứng.'],
    };
  }

  const defCheck = validateConstraintDefinitions(template.parameters);
  if (!defCheck.valid) {
    return {
      status: 'BLOCKED',
      canGenerateVariant: false,
      reasons: defCheck.errors,
    };
  }

  return {
    status: 'VARIANT_READY',
    canGenerateVariant: true,
    reasons: ['Đủ điều kiện sinh biến thể đổi số có kiểm chứng độc lập.'],
  };
}

function buildFamilyCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>
): { ok: true; candidate: ComputedFamilyCandidate } | { ok: false; reason: string } {
  const unit = template.unit ?? VERIFIED_TEMPLATE_FAMILIES[template.familyId].defaultUnit;
  const decimalPlaces =
    template.decimalPlaces ??
    VERIFIED_TEMPLATE_FAMILIES[template.familyId].defaultDecimalPlaces;

  switch (template.familyId) {
    case 'linear-equation': {
      const a = rawParams.a;
      const x0 = rawParams.x0;
      const b = rawParams.b;
      if (Math.abs(a) <= NUMERIC_EPSILON) {
        return { ok: false, reason: 'Hệ số a = 0 làm phương trình suy biến (chia cho 0).' };
      }
      const c = a * x0 + b;
      const rhs = c - b;
      const answer = rhs / a;
      if (!Number.isFinite(answer)) {
        return { ok: false, reason: 'Nghiệm phương trình không hữu hạn.' };
      }
      const tokens = {
        a: formatMathNumber(a),
        b: formatMathNumber(b),
        bSigned: formatSignedTerm(b),
        c: formatMathNumber(c),
        rhs: formatMathNumber(rhs),
        ans: formatMathNumber(answer),
      };
      return {
        ok: true,
        candidate: {
          params: { a, x0, b, c },
          answer,
          unit,
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            const lhs = a * val + b;
            const ok = areNumbersEquivalent(lhs, c, 1e-6);
            return {
              ok,
              proofText: `Thế ngược x = ${formatMathNumber(val)}: ${a}·(${formatMathNumber(val)}) ${formatSignedTerm(b)} = ${formatMathNumber(lhs)} ${ok ? '=' : '≠'} ${c}`,
            };
          },
          distractorCandidates: [
            -answer,
            answer + 1,
            answer - 1,
            answer + 2,
            answer - 2,
            Math.round((c + b) / a),
            answer + a,
            answer - a,
          ],
        },
      };
    }

    case 'arithmetic-expression': {
      const { p, q, r, s } = rawParams;
      const sum = q + r;
      const prod = p * sum;
      const answer = prod - s;
      // Independent distributive verification
      const expanded = p * q + p * r - s;
      if (!areNumbersEquivalent(answer, expanded)) {
        return { ok: false, reason: 'Sai lệch giữa tính trong ngoặc và khai triển phân phối.' };
      }
      const tokens = {
        p: formatMathNumber(p),
        q: formatMathNumber(q),
        r: formatMathNumber(r),
        rSigned: formatSignedTerm(r),
        s: formatMathNumber(s),
        sum: formatMathNumber(sum),
        prod: formatMathNumber(prod),
        ans: formatMathNumber(answer),
      };
      return {
        ok: true,
        candidate: {
          params: { p, q, r, s },
          answer,
          unit,
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            const check = p * q + p * r - s;
            const ok = areNumbersEquivalent(val, check, 1e-6);
            return {
              ok,
              proofText: `Kiểm chứng phân phối: ${p}·${q} + ${p}·(${r}) - ${s} = ${check}`,
            };
          },
          distractorCandidates: [
            p * q + r - s, // classic parenthesis mistake
            prod + s, // sign error on -s
            answer + p,
            answer - p,
            answer + 2,
            answer - 2,
            -answer,
          ],
        },
      };
    }

    case 'algebraic-eval': {
      const { a, b, c, x0 } = rawParams;
      if (Math.abs(a) <= NUMERIC_EPSILON) {
        return { ok: false, reason: 'Hệ số bậc hai a không được bằng 0.' };
      }
      const answer = a * x0 * x0 + b * x0 + c;
      const tokens = {
        a: formatMathNumber(a),
        b: formatMathNumber(b),
        bSigned: formatSignedTerm(b),
        c: formatMathNumber(c),
        cSigned: formatSignedTerm(c),
        x0: formatMathNumber(x0),
        ans: formatMathNumber(answer),
      };
      return {
        ok: true,
        candidate: {
          params: { a, b, c, x0 },
          answer,
          unit,
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            // Independent Horner's method
            const horner = (a * x0 + b) * x0 + c;
            const ok = areNumbersEquivalent(val, horner, 1e-6);
            return {
              ok,
              proofText: `Lược đồ Horner tại x₀ = ${x0}: ((${a}·(${x0}) ${formatSignedTerm(b)})·(${x0}) ${formatSignedTerm(c)}) = ${horner}`,
            };
          },
          distractorCandidates: [
            a * x0 * x0 - b * x0 + c,
            -a * x0 * x0 + b * x0 + c,
            a * x0 + b * x0 + c,
            answer + 2,
            answer - 2,
            answer + Math.abs(b) + 1,
            answer - Math.abs(a) - 1,
          ],
        },
      };
    }

    case 'percentage-problem': {
      const { baseHundreds, percent } = rawParams;
      if (baseHundreds <= 0 || percent <= 0 || percent >= 100) {
        return { ok: false, reason: 'Giá gốc phải > 0 và phần trăm phải nằm trong (0, 100).' };
      }
      const basePrice = baseHundreds * 100;
      const discount = (basePrice * percent) / 100;
      const answer = basePrice - discount;
      const remainPercent = 100 - percent;
      if (!Number.isInteger(answer) && decimalPlaces === 0) {
        return { ok: false, reason: 'Kết quả giá sau giảm không nguyên theo yêu cầu mẫu.' };
      }
      const tokens = {
        basePrice: formatMathNumber(basePrice),
        percent: formatMathNumber(percent),
        discount: formatMathNumber(discount),
        remainPercent: formatMathNumber(remainPercent),
        ans: formatMathNumber(answer),
      };
      return {
        ok: true,
        candidate: {
          params: { baseHundreds, percent, basePrice },
          answer,
          unit,
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            const ratioPercent = (val / basePrice) * 100;
            const ok = areNumbersEquivalent(ratioPercent, 100 - percent, 1e-6);
            return {
              ok,
              proofText: `Tỉ số kiểm chứng: ${val} / ${basePrice} = ${formatMathNumber(ratioPercent, 2)}% (chuẩn ${100 - percent}%)`,
            };
          },
          distractorCandidates: [
            basePrice + discount, // added instead of subtracted
            discount, // forgot to subtract from basePrice
            answer + 10,
            answer - 10,
            answer + 20,
            answer - 20,
            basePrice - percent, // subtracted raw % number
          ],
        },
      };
    }

    case 'proportion-ratio': {
      const { a, b, k } = rawParams;
      if (Math.abs(b) <= NUMERIC_EPSILON) {
        return { ok: false, reason: 'Mẫu số b = 0 (chia cho 0 — chặn bắt buộc).' };
      }
      const c = b * k;
      const answer = (a * c) / b;
      const crossLeft = a * c;
      const crossRight = b * answer;
      const tokens = {
        a: formatMathNumber(a),
        b: formatMathNumber(b),
        c: formatMathNumber(c),
        ans: formatMathNumber(answer),
        crossLeft: formatMathNumber(crossLeft),
        crossRight: formatMathNumber(crossRight),
      };
      return {
        ok: true,
        candidate: {
          params: { a, b, k, c },
          answer,
          unit,
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            const ok = areNumbersEquivalent(a * c, b * val, 1e-6);
            return {
              ok,
              proofText: `Tích chéo: a·c = ${a}·${c} = ${a * c}; b·x = ${b}·${formatMathNumber(val)} = ${formatMathNumber(b * val)}`,
            };
          },
          distractorCandidates: [
            answer + a,
            answer - a,
            a + k,
            b * k,
            answer + 2,
            answer - 2,
            answer + b,
          ],
        },
      };
    }

    case 'arithmetic-sequence': {
      const { u1, d, n } = rawParams;
      if (!Number.isInteger(n) || n < 2) {
        return { ok: false, reason: 'Chỉ số n của dãy số phải là số nguyên ≥ 2.' };
      }
      const answer = u1 + (n - 1) * d;
      const tokens = {
        u1: formatMathNumber(u1),
        d: formatMathNumber(d),
        n: formatMathNumber(n),
        ans: formatMathNumber(answer),
      };
      return {
        ok: true,
        candidate: {
          params: { u1, d, n },
          answer,
          unit,
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            // Independent iterative recurrence
            let curr = u1;
            for (let step = 2; step <= n; step += 1) {
              curr += d;
            }
            const ok = areNumbersEquivalent(val, curr, 1e-6);
            return {
              ok,
              proofText: `Truy hồi từng bước u₁..u${n}: u${n} = ${curr}`,
            };
          },
          distractorCandidates: [
            u1 + n * d, // classic (n) instead of (n-1)
            u1 + (n - 2) * d,
            u1 - (n - 1) * d,
            answer + d,
            answer - d,
            answer + 2,
            answer - 2,
          ],
        },
      };
    }

    case 'physics-motion': {
      const { v, t } = rawParams;
      if (t <= NUMERIC_EPSILON) {
        return { ok: false, reason: 'Thời gian t ≤ 0 (không hợp lệ về Vật lý / chia cho 0).' };
      }
      const s = roundToPlaces(v * t, 2);
      const answer = roundToPlaces(s / t, decimalPlaces);
      const tokens = {
        s: formatMathNumber(s),
        t: formatMathNumber(t),
        ans: formatMathNumber(answer, decimalPlaces),
      };
      return {
        ok: true,
        candidate: {
          params: { v, t, s },
          answer,
          unit: unit || 'km/h',
          decimalPlaces,
          stemLatex: interpolateTokens(template.stemTemplate, tokens),
          explanationLatex: interpolateTokens(template.explanationTemplate, tokens),
          independentVerify: (val: number) => {
            const reconstructedS = val * t;
            const ok = val > 0 && areNumbersEquivalent(reconstructedS, s, 1e-6);
            return {
              ok,
              proofText: `Kiểm chứng ngược s = v·t: ${formatMathNumber(val)} · ${t} = ${formatMathNumber(reconstructedS)} km (khớp ${s} km)`,
            };
          },
          distractorCandidates: [
            roundToPlaces(s * t, decimalPlaces), // multiplied instead of divided
            answer + 5,
            Math.max(1, answer - 5),
            answer + 10,
            Math.max(1, answer - 10),
            answer + t,
            Math.max(1, answer - t),
          ],
        },
      };
    }

    default:
      return {
        ok: false,
        reason: `Nhóm mẫu "${template.familyId}" sử dụng bộ giải nâng cao Level 2.`,
      };
  }
}

function isAdvancedLevel2Family(familyId: VerifiedTemplateFamilyId): boolean {
  return (
    familyId === 'quadratic-equation' ||
    familyId === 'linear-system-2x2' ||
    familyId === 'polynomial-derivative'
  );
}

function buildAdvancedFamilyCandidate(
  template: QuestionTemplateDefinition,
  rawParams: Record<string, number>
): { ok: true; candidate: AdvancedFamilyCandidate } | { ok: false; reason: string } {
  switch (template.familyId) {
    case 'quadratic-equation':
      return buildQuadraticCandidate(template, rawParams);
    case 'linear-system-2x2':
      return buildLinearSystemCandidate(template, rawParams);
    case 'polynomial-derivative':
      return buildPolynomialDerivativeCandidate(template, rawParams);
    default:
      return { ok: false, reason: 'Không phải nhóm mẫu nâng cao Level 2.' };
  }
}

function buildValidatedStructuredDistractors(
  candidate: AdvancedFamilyCandidate,
  rng: SeededRng
): {
  ok: boolean;
  options: StructuredOptionCandidate[];
  uniqueCount: number;
  validCount: number;
  reason?: string;
} {
  const correctOpt: StructuredOptionCandidate = {
    latex: candidate.correctLatex,
    canonicalKey: candidate.correctCanonicalKey,
    isCorrect: true,
    satisfiesProblem: true,
  };

  const chosen: StructuredOptionCandidate[] = [correctOpt];
  const seenKeys = new Set<string>([candidate.correctCanonicalKey]);
  const seenLatex = new Set<string>([candidate.correctLatex.replace(/\s+/g, '')]);

  const pool = rng.shuffle(candidate.structuredDistractors);

  for (const dist of pool) {
    if (chosen.length >= 4) break;
    // CRITICAL: Must NOT satisfy problem AND must NOT be mathematically equivalent to any chosen option!
    if (dist.satisfiesProblem) continue;
    if (candidate.verifyStructuredOptionCorrect(dist.canonicalKey)) continue;
    if (seenKeys.has(dist.canonicalKey)) continue;
    const normLatex = dist.latex.replace(/\s+/g, '');
    if (seenLatex.has(normLatex)) continue;

    seenKeys.add(dist.canonicalKey);
    seenLatex.add(normLatex);
    chosen.push(dist);
  }

  if (chosen.length !== 4) {
    return {
      ok: false,
      options: chosen,
      uniqueCount: chosen.length,
      validCount: 1,
      reason: `Không tạo đủ 4 phương án phân biệt về mặt toán học (chỉ tạo được ${chosen.length}/4).`,
    };
  }

  // Final independent audit: strictly 4 unique canonical keys & strictly 1 option satisfies problem
  const uniqueKeys = new Set(chosen.map((o) => o.canonicalKey));
  const validMatches = chosen.filter(
    (o) => o.satisfiesProblem || candidate.verifyStructuredOptionCorrect(o.canonicalKey)
  );

  if (uniqueKeys.size !== 4) {
    return {
      ok: false,
      options: chosen,
      uniqueCount: uniqueKeys.size,
      validCount: validMatches.length,
      reason: 'Phát hiện 2 phương án tương đương về mặt toán học — chặn bắt buộc.',
    };
  }

  if (validMatches.length !== 1) {
    return {
      ok: false,
      options: chosen,
      uniqueCount: uniqueKeys.size,
      validCount: validMatches.length,
      reason: `Phát hiện ${validMatches.length} phương án thỏa mãn bài toán (bắt buộc duy nhất 1 phương án đúng).`,
    };
  }

  return {
    ok: true,
    options: chosen,
    uniqueCount: 4,
    validCount: 1,
  };
}

function buildNormalizedContentKey(stemLatex: string, answerKey: string): string {
  const normStem = stemLatex
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return `${normStem}::${answerKey}`;
}

function buildValidatedDistractors(
  candidate: ComputedFamilyCandidate,
  rng: SeededRng
): {
  ok: boolean;
  values: number[];
  uniqueCount: number;
  validCount: number;
  reason?: string;
} {
  const chosen: number[] = [candidate.answer];
  const seenFormatted = new Set<string>([
    formatOptionValue(candidate.answer, candidate.unit, candidate.decimalPlaces),
  ]);

  const pool = rng.shuffle(candidate.distractorCandidates);

  const tryAddDistractor = (val: number): boolean => {
    if (!Number.isFinite(val)) return false;
    const rounded = roundToPlaces(val, candidate.decimalPlaces);
    if (areNumbersEquivalent(rounded, candidate.answer, 1e-6)) return false;
    // Domain sanity: motion speed / percentage price should stay positive
    if (
      (candidate.unit === 'km/h' || candidate.unit === 'm/s' || candidate.unit === 'nghìn đồng') &&
      rounded <= 0
    ) {
      return false;
    }
    const formatted = formatOptionValue(rounded, candidate.unit, candidate.decimalPlaces);
    if (seenFormatted.has(formatted)) return false;
    // CRITICAL: Independent verification predicate MUST return FALSE for every distractor!
    if (candidate.independentVerify(rounded).ok) return false;
    seenFormatted.add(formatted);
    chosen.push(rounded);
    return true;
  };

  for (const d of pool) {
    if (chosen.length >= 4) break;
    tryAddDistractor(d);
  }

  // Deterministic bounded offset fallback if pool had collisions
  let offset = 1;
  while (chosen.length < 4 && offset <= 20) {
    const delta = candidate.decimalPlaces > 0 ? offset / Math.pow(10, candidate.decimalPlaces) : offset;
    tryAddDistractor(candidate.answer + delta);
    if (chosen.length < 4) {
      tryAddDistractor(candidate.answer - delta);
    }
    offset += 1;
  }

  if (chosen.length !== 4) {
    return {
      ok: false,
      values: chosen,
      uniqueCount: chosen.length,
      validCount: 1,
      reason: `Không tạo đủ 4 phương án phân biệt (chỉ tạo được ${chosen.length}).`,
    };
  }

  // Final strict audit across all 4 options: EXACTLY 1 option satisfies independentVerify
  const validMatches = chosen.filter((v) => candidate.independentVerify(v).ok);
  const formattedSet = new Set(
    chosen.map((v) => formatOptionValue(v, candidate.unit, candidate.decimalPlaces))
  );

  if (formattedSet.size !== 4) {
    return {
      ok: false,
      values: chosen,
      uniqueCount: formattedSet.size,
      validCount: validMatches.length,
      reason: 'Phát hiện phương án trùng lặp sau khi định dạng.',
    };
  }
  if (validMatches.length !== 1) {
    return {
      ok: false,
      values: chosen,
      uniqueCount: formattedSet.size,
      validCount: validMatches.length,
      reason: `Phát hiện ${validMatches.length} phương án thỏa mãn bài toán (bắt buộc đúng 1 phương án duy nhất).`,
    };
  }

  return {
    ok: true,
    values: chosen,
    uniqueCount: 4,
    validCount: 1,
  };
}

/**
 * Pipeline kiểm chứng bắt buộc:
 * Generate -> Validate Constraints -> Solve -> Independent Substitute/Verify ->
 * Validate Result Bounds -> Generate & Audit 4 Distinct Distractors -> Validate Explanation -> Approve.
 */
export function generateVerifiedVariant(params: {
  template: QuestionTemplateDefinition;
  seed: string;
  variantIndex?: number;
  parentQuestionId?: string;
  excludeSignatures?: ReadonlySet<string>;
  forcedParameterValues?: Record<string, number>;
}): VariantGenerationOutcome {
  const {
    template,
    seed,
    variantIndex = 1,
    parentQuestionId,
    excludeSignatures,
    forcedParameterValues,
  } = params;

  if (!template.verifiedTemplate || !(template.familyId in VERIFIED_TEMPLATE_FAMILIES)) {
    return {
      ok: false,
      status: 'UNSUPPORTED',
      blockingReasons: [
        `Mẫu "${template.title}" không thuộc danh sách mẫu Level 1 & Level 2 đã được kiểm chứng.`,
      ],
      attemptsUsed: 0,
    };
  }

  const defCheck = validateConstraintDefinitions(template.parameters);
  if (!defCheck.valid) {
    return {
      ok: false,
      status: 'BLOCKED',
      blockingReasons: [GENERATION_FAILED_CONSTRAINTS_MSG, ...defCheck.errors],
      attemptsUsed: 0,
    };
  }

  const rng = createSeededRng(`${seed}::${template.id}::V${variantIndex}`);
  const lastReasons: string[] = [];
  const maxTries = forcedParameterValues ? 1 : MAX_GENERATION_ATTEMPTS;
  const isLevel2 = isAdvancedLevel2Family(template.familyId);
  const isLevel3 = isLevel3GraphFamily(template.familyId);

  for (let attempt = 1; attempt <= maxTries; attempt += 1) {
    const sampled: Record<string, number> = {};
    let samplingFailed = false;

    if (forcedParameterValues) {
      Object.assign(sampled, forcedParameterValues);
    } else {
      for (const c of template.parameters) {
        const val = sampleParameterValue(c, rng);
        if (val === null) {
          samplingFailed = true;
          lastReasons.push(`Không thể sinh giá trị hợp lệ cho tham số "${c.name}".`);
          break;
        }
        sampled[c.name] = val;
      }
    }

    if (samplingFailed) continue;

    // 1. Validate Parameter Constraints
    const valCheck = validateParameterValues(template.parameters, sampled);
    if (!valCheck.valid) {
      lastReasons.push(...valCheck.errors);
      continue;
    }

    // 2B. LEVEL 3 DYNAMIC MATH, SVG GRAPH & VARIATION TABLE PIPELINE
    if (isLevel3) {
      const prelimSig = buildParameterSignature(sampled);
      const baseCode = template.code || 'GR3';
      const variantCode = `${baseCode}-V${variantIndex}`;
      const qId = `var-${template.id}-v${variantIndex}-${prelimSig.replace(/[^a-zA-Z0-9]/g, '')}`;

      const built = buildLevel3GraphCandidate(template, sampled, qId, rng);
      if (
        !built.ok ||
        !built.analysis ||
        !built.graphSvg ||
        !built.variationTable ||
        !built.variationTableSvg ||
        !built.stemLatex ||
        !built.explanationLatex
      ) {
        lastReasons.push(built.error ?? 'Không sinh được biến thể đồ thị hàm số hợp lệ.');
        continue;
      }

      const signature = buildParameterSignature(built.params);
      if (excludeSignatures && excludeSignatures.has(signature)) {
        lastReasons.push(`Bộ tham số (${signature}) bị trùng với biến thể đã sinh.`);
        continue;
      }

      if (template.questionType === 'short-answer' && !built.allowShortAnswer) {
        lastReasons.push(
          'Dạng câu hỏi đồ thị/khoảng đơn điệu/tiệm cận này chỉ hỗ trợ Trắc nghiệm (MCQ), không tự chấm Trả lời ngắn.'
        );
        continue;
      }

      const now = new Date().toISOString();
      const resolvedParentId = parentQuestionId ?? template.sourceQuestionId ?? template.id;

      let options: McqOption[] | undefined;
      let correctOptionId: string | undefined;
      let correctOptionLabel: McqOptionLabel | undefined;
      let uniqueOptionCount = 1;
      let validOptionCount = 1;

      if (template.questionType === 'mcq') {
        if (!built.options || built.options.length !== 4) {
          lastReasons.push('Không tạo đủ 4 phương án phân biệt về mặt toán học.');
          continue;
        }
        const uniqueKeys = new Set(built.options.map((o) => o.canonicalKey));
        const correctCnt = built.options.filter((o) => o.isCorrect).length;
        if (uniqueKeys.size !== 4 || correctCnt !== 1) {
          lastReasons.push('Phát hiện phương án trùng lặp hoặc sai số lượng đáp án đúng.');
          continue;
        }
        uniqueOptionCount = uniqueKeys.size;
        validOptionCount = correctCnt;

        const shuffledOpts = rng.shuffle(built.options);
        options = shuffledOpts.map((optItem, idx) => {
          const label = MCQ_LABELS[idx];
          const optId = `${qId}-opt-${label.toLowerCase()}`;
          if (optItem.isCorrect) {
            correctOptionId = optId;
            correctOptionLabel = label;
          }
          return {
            id: optId,
            originalLabel: label,
            content: parseMathContent(optItem.displayLatex, `${qId}-opt${idx}`),
            isCorrect: optItem.isCorrect,
            ...(optItem.visualAsset ? { visualAsset: optItem.visualAsset } : {}),
          };
        });

        if (!correctOptionId || !correctOptionLabel) {
          lastReasons.push('Không xác định được phương án đúng sau khi trộn vị trí A/B/C/D.');
          continue;
        }
      }

      const questionAssets = built.questionAssets ?? [];
      const hasAnyVisual =
        questionAssets.length > 0 || Boolean(options?.some((o) => Boolean(o.visualAsset)));

      const question: MathQuestion = {
        id: qId,
        code: variantCode,
        sectionTitle:
          template.questionType === 'mcq'
            ? MATH_SECTION_TITLES.mcq
            : MATH_SECTION_TITLES['short-answer'],
        type: template.questionType,
        universalType: template.questionType,
        subjectId: template.subjectId,
        topic: template.topic,
        cognitiveLevel: template.cognitiveLevel,
        difficultyScore:
          template.cognitiveLevel === 'nhan-biet'
            ? 1
            : template.cognitiveLevel === 'thong-hieu'
            ? 2
            : template.cognitiveLevel === 'van-dung'
            ? 3
            : 4,
        points: template.points,
        stem: parseMathContent(built.stemLatex, `${qId}-stem`),
        ...(template.questionType === 'mcq'
          ? { options, correctOptionId }
          : {
              shortAnswer: {
                answerValue: built.shortAnswerValue ?? String(built.numericAnswer ?? 0),
                acceptedFormats: built.shortAnswerAccepted ?? [
                  built.shortAnswerValue ?? String(built.numericAnswer ?? 0),
                ],
              },
            }),
        solutionGuide: parseMathContent(built.explanationLatex, `${qId}-sol`),
        visualAssets: questionAssets,
        lockQuestionPosition: false,
        lockOptionShuffle: false,
        allowStatementShuffle: false,
        dependencyFlags: [],
        hasVisualAsset: hasAnyVisual,
        answerConfirmed: false,
        variantMeta: {
          parentQuestionId: resolvedParentId,
          templateId: template.id,
          variantId: qId,
          variantCode,
          seed,
          parameterSignature: signature,
          parameterValues: built.params,
          verificationSummary: built.verificationProof ?? built.analysis.verificationProof,
          verifiedAt: now,
          graphFingerprint: built.analysis.fingerprint,
          dynamicFunctionFamily: built.functionFamily,
        },
        createdAt: now,
        updatedAt: now,
      };

      const bindingCheck = verifyDynamicGraphBinding({
        question,
        functionAnalysis: built.analysis,
        variationTable: built.variationTable,
        graphFingerprint: built.analysis.fingerprint,
      });
      if (!bindingCheck.valid) {
        lastReasons.push(bindingCheck.reason ?? 'Lỗi đồng bộ fingerprint đồ thị.');
        continue;
      }

      const checklist: VariantValidationChecklist = {
        dataValid: true,
        solutionVerified: built.analysis.verificationPassed,
        optionsDistinct:
          template.questionType === 'mcq'
            ? uniqueOptionCount === 4 && validOptionCount === 1
            : true,
        explanationAligned: built.explanationLatex.trim().length > 0,
        canExportExam: bindingCheck.valid && built.analysis.verificationPassed,
        requiresTeacherConfirmation: true,
        graphConsistent: bindingCheck.valid && !built.graphSvg.includes('NaN'),
        variationTableConsistent:
          built.variationTable.fingerprint === built.analysis.fingerprint &&
          built.variationTable.columns.length >= 3,
      };

      const verification: VariantVerificationProof = {
        passed: true,
        independentCheckSummary: built.verificationProof ?? built.analysis.verificationProof,
        distractorCheckPassed: true,
        uniqueOptionCount,
        validOptionCount,
        reasons: [],
        checklist,
      };

      const correctCanonicalKey = built.correctCanonicalKey ?? built.analysis.fingerprint;
      const variant: GeneratedQuestionVariant = {
        id: qId,
        variantCode,
        parentQuestionId: resolvedParentId,
        templateId: template.id,
        familyId: template.familyId,
        seed,
        parameterSignature: signature,
        parameterValues: built.params,
        question,
        correctValue: built.numericAnswer ?? 0,
        correctFormatted: built.correctDisplayLatex ?? '',
        correctCanonicalKey,
        normalizedContentKey: buildNormalizedContentKey(
          built.stemLatex,
          `${correctCanonicalKey}::${built.analysis.fingerprint}`
        ),
        correctOptionLabel,
        explanationText: built.explanationLatex,
        status: 'VARIANT_READY',
        verification,
        graphFingerprint: built.analysis.fingerprint,
        functionAnalysis: built.analysis,
        graphSvg: built.graphSvg,
        variationTable: built.variationTable,
        variationTableSvg: built.variationTableSvg,
        attemptsUsed: attempt,
        generatedAt: now,
      };

      return {
        ok: true,
        status: 'VARIANT_READY',
        variant,
        blockingReasons: [],
        attemptsUsed: attempt,
      };
    }

    // 2A. LEVEL 2 ADVANCED MATH PIPELINE (Quadratic, Linear System 2x2, Polynomial Derivative)
    if (isLevel2) {
      const solvedAdv = buildAdvancedFamilyCandidate(template, sampled);
      if (!solvedAdv.ok) {
        lastReasons.push(solvedAdv.reason);
        continue;
      }
      const adv = solvedAdv.candidate;

      const signature = buildParameterSignature(adv.params);
      if (excludeSignatures && excludeSignatures.has(signature)) {
        lastReasons.push(`Bộ tham số (${signature}) bị trùng với biến thể đã sinh.`);
        continue;
      }

      if (Number.isFinite(adv.scalarAnswer)) {
        if (
          template.resultMin !== undefined &&
          adv.scalarAnswer < template.resultMin - NUMERIC_EPSILON
        ) {
          lastReasons.push(
            `Đáp án ${adv.scalarAnswer} nhỏ hơn cận dưới cho phép (${template.resultMin}).`
          );
          continue;
        }
        if (
          template.resultMax !== undefined &&
          adv.scalarAnswer > template.resultMax + NUMERIC_EPSILON
        ) {
          lastReasons.push(
            `Đáp án ${adv.scalarAnswer} lớn hơn cận trên cho phép (${template.resultMax}).`
          );
          continue;
        }
      }

      if (!adv.stemLatex.trim() || !adv.explanationLatex.trim()) {
        lastReasons.push('Đề bài hoặc lời giải bị rỗng.');
        continue;
      }

      const now = new Date().toISOString();
      const baseCode = template.code || 'TPL2';
      const variantCode = `${baseCode}-V${variantIndex}`;
      const qId = `var-${template.id}-v${variantIndex}-${signature.replace(/[^a-zA-Z0-9]/g, '')}`;
      const resolvedParentId = parentQuestionId ?? template.sourceQuestionId ?? template.id;

      let options: McqOption[] | undefined;
      let correctOptionId: string | undefined;
      let correctOptionLabel: McqOptionLabel | undefined;
      let uniqueOptionCount = 1;
      let validOptionCount = 1;

      if (template.questionType === 'mcq') {
        const distResult = buildValidatedStructuredDistractors(adv, rng);
        if (!distResult.ok) {
          lastReasons.push(distResult.reason ?? 'Lỗi kiểm chứng phương án nhiễu toán học.');
          continue;
        }
        uniqueOptionCount = distResult.uniqueCount;
        validOptionCount = distResult.validCount;

        const shuffledOpts = rng.shuffle(distResult.options);
        options = shuffledOpts.map((optItem, idx) => {
          const label = MCQ_LABELS[idx];
          const optId = `${qId}-opt-${label.toLowerCase()}`;
          if (optItem.isCorrect) {
            correctOptionId = optId;
            correctOptionLabel = label;
          }
          return {
            id: optId,
            originalLabel: label,
            content: parseMathContent(optItem.latex, `${qId}-opt${idx}`),
            isCorrect: optItem.isCorrect,
          };
        });

        if (!correctOptionId || !correctOptionLabel) {
          lastReasons.push('Không xác định được phương án đúng sau khi trộn vị trí A/B/C/D.');
          continue;
        }
      } else if (!adv.correctPlainShortAnswer) {
        lastReasons.push('Đáp án không phù hợp định dạng Trả lời ngắn một số duy nhất.');
        continue;
      }

      const checklist: VariantValidationChecklist = {
        dataValid: true,
        solutionVerified: true,
        optionsDistinct: template.questionType === 'mcq' ? uniqueOptionCount === 4 && validOptionCount === 1 : true,
        explanationAligned: adv.explanationLatex.trim().length > 0,
        canExportExam: true,
        requiresTeacherConfirmation: true,
      };

      const verification: VariantVerificationProof = {
        passed: true,
        independentCheckSummary: adv.independentProofText,
        distractorCheckPassed: checklist.optionsDistinct,
        uniqueOptionCount,
        validOptionCount,
        reasons: [],
        checklist,
      };

      const question: MathQuestion = {
        id: qId,
        code: variantCode,
        sectionTitle:
          template.questionType === 'mcq'
            ? MATH_SECTION_TITLES.mcq
            : MATH_SECTION_TITLES['short-answer'],
        type: template.questionType,
        universalType: template.questionType,
        subjectId: template.subjectId,
        topic: template.topic,
        cognitiveLevel: template.cognitiveLevel,
        difficultyScore:
          template.cognitiveLevel === 'nhan-biet'
            ? 1
            : template.cognitiveLevel === 'thong-hieu'
            ? 2
            : template.cognitiveLevel === 'van-dung'
            ? 3
            : 4,
        points: template.points,
        stem: parseMathContent(adv.stemLatex, `${qId}-stem`),
        ...(template.questionType === 'mcq'
          ? { options, correctOptionId }
          : {
              shortAnswer: {
                answerValue: adv.correctPlainShortAnswer!,
                acceptedFormats: Array.from(
                  new Set([
                    adv.correctPlainShortAnswer!,
                    adv.correctPlainShortAnswer!.replace('.', ','),
                  ])
                ),
                unit: template.unit,
              },
            }),
        solutionGuide: parseMathContent(adv.explanationLatex, `${qId}-sol`),
        lockQuestionPosition: false,
        lockOptionShuffle: false,
        allowStatementShuffle: false,
        dependencyFlags: [],
        hasVisualAsset: false,
        answerConfirmed: false,
        variantMeta: {
          parentQuestionId: resolvedParentId,
          templateId: template.id,
          variantCode,
          seed,
          parameterSignature: signature,
          parameterValues: adv.params,
          verificationSummary: adv.independentProofText,
          verifiedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };

      const variant: GeneratedQuestionVariant = {
        id: qId,
        variantCode,
        parentQuestionId: resolvedParentId,
        templateId: template.id,
        familyId: template.familyId,
        seed,
        parameterSignature: signature,
        parameterValues: adv.params,
        question,
        correctValue: adv.scalarAnswer,
        correctFormatted: adv.correctLatex,
        correctCanonicalKey: adv.correctCanonicalKey,
        normalizedContentKey: buildNormalizedContentKey(adv.stemLatex, adv.correctCanonicalKey),
        correctOptionLabel,
        explanationText: adv.explanationLatex,
        status: 'VARIANT_READY',
        verification,
        attemptsUsed: attempt,
        generatedAt: now,
      };

      return {
        ok: true,
        status: 'VARIANT_READY',
        variant,
        blockingReasons: [],
        attemptsUsed: attempt,
      };
    }

    // 2B. LEVEL 1 VERIFIED PIPELINE (preserved 100% intact)
    const solved = buildFamilyCandidate(template, sampled);
    if (!solved.ok) {
      lastReasons.push(solved.reason);
      continue;
    }

    const candidate = solved.candidate;

    // 3. Check duplicate parameter signature
    const signature = buildParameterSignature(candidate.params);
    if (excludeSignatures && excludeSignatures.has(signature)) {
      lastReasons.push(`Bộ tham số (${signature}) bị trùng với biến thể đã sinh.`);
      continue;
    }

    // 4. Validate result range
    if (
      template.resultMin !== undefined &&
      candidate.answer < template.resultMin - NUMERIC_EPSILON
    ) {
      lastReasons.push(
        `Đáp án ${candidate.answer} nhỏ hơn cận dưới cho phép (${template.resultMin}).`
      );
      continue;
    }
    if (
      template.resultMax !== undefined &&
      candidate.answer > template.resultMax + NUMERIC_EPSILON
    ) {
      lastReasons.push(
        `Đáp án ${candidate.answer} lớn hơn cận trên cho phép (${template.resultMax}).`
      );
      continue;
    }

    // 5. Independent verification (substitution / recurrence / cross-product)
    const verifyCheck = candidate.independentVerify(candidate.answer);
    if (!verifyCheck.ok) {
      lastReasons.push(
        `Kiểm chứng độc lập thất bại: ${verifyCheck.proofText}`
      );
      continue;
    }

    // 6. Validate stem & explanation contain no unresolved placeholders
    if (
      candidate.stemLatex.includes('{{') ||
      candidate.explanationLatex.includes('{{') ||
      !candidate.stemLatex.trim() ||
      !candidate.explanationLatex.trim()
    ) {
      lastReasons.push('Đề bài hoặc lời giải còn biến chưa thay thế hoặc bị rỗng.');
      continue;
    }

    const now = new Date().toISOString();
    const baseCode = template.code || 'TPL';
    const variantCode = `${baseCode}-V${variantIndex}`;
    const qId = `var-${template.id}-v${variantIndex}-${signature.replace(/[^a-zA-Z0-9]/g, '')}`;
    const resolvedParentId = parentQuestionId ?? template.sourceQuestionId ?? template.id;

    let options: McqOption[] | undefined;
    let correctOptionId: string | undefined;
    let correctOptionLabel: McqOptionLabel | undefined;
    let uniqueOptionCount = 1;
    let validOptionCount = 1;

    if (template.questionType === 'mcq') {
      const distResult = buildValidatedDistractors(candidate, rng);
      if (!distResult.ok) {
        lastReasons.push(distResult.reason ?? 'Lỗi tạo phương án nhiễu.');
        continue;
      }
      uniqueOptionCount = distResult.uniqueCount;
      validOptionCount = distResult.validCount;

      // Shuffle the 4 validated option values deterministically
      const shuffledVals = rng.shuffle(distResult.values);
      options = shuffledVals.map((val, idx) => {
        const label = MCQ_LABELS[idx];
        const isCorrect = areNumbersEquivalent(val, candidate.answer, 1e-6);
        const optId = `${qId}-opt-${label.toLowerCase()}`;
        if (isCorrect) {
          correctOptionId = optId;
          correctOptionLabel = label;
        }
        return {
          id: optId,
          originalLabel: label,
          content: parseMathContent(
            formatOptionValue(val, candidate.unit, candidate.decimalPlaces),
            `${qId}-opt${idx}`
          ),
          isCorrect,
        };
      });

      if (!correctOptionId || !correctOptionLabel) {
        lastReasons.push('Không xác định được phương án đúng sau khi trộn vị trí A/B/C/D.');
        continue;
      }
    }

    const correctFormatted = formatOptionValue(
      candidate.answer,
      candidate.unit,
      candidate.decimalPlaces
    );
    const correctCanonicalKey = canonicalizeMathAnswer(
      formatMathNumber(candidate.answer, candidate.decimalPlaces)
    );

    const checklist: VariantValidationChecklist = {
      dataValid: true,
      solutionVerified: true,
      optionsDistinct: template.questionType === 'mcq' ? uniqueOptionCount === 4 && validOptionCount === 1 : true,
      explanationAligned: candidate.explanationLatex.trim().length > 0,
      canExportExam: true,
      requiresTeacherConfirmation: true,
    };

    const verification: VariantVerificationProof = {
      passed: true,
      independentCheckSummary: verifyCheck.proofText,
      distractorCheckPassed: true,
      uniqueOptionCount,
      validOptionCount,
      reasons: [],
      checklist,
    };

    const question: MathQuestion = {
      id: qId,
      code: variantCode,
      sectionTitle:
        template.questionType === 'mcq'
          ? MATH_SECTION_TITLES.mcq
          : MATH_SECTION_TITLES['short-answer'],
      type: template.questionType,
      universalType: template.questionType,
      subjectId: template.subjectId,
      topic: template.topic,
      cognitiveLevel: template.cognitiveLevel,
      difficultyScore:
        template.cognitiveLevel === 'nhan-biet'
          ? 1
          : template.cognitiveLevel === 'thong-hieu'
          ? 2
          : template.cognitiveLevel === 'van-dung'
          ? 3
          : 4,
      points: template.points,
      stem: parseMathContent(candidate.stemLatex, `${qId}-stem`),
      ...(template.questionType === 'mcq'
        ? { options, correctOptionId }
        : {
            shortAnswer: {
              answerValue: formatMathNumber(candidate.answer, candidate.decimalPlaces),
              acceptedFormats: [
                formatMathNumber(candidate.answer, candidate.decimalPlaces),
                formatViNumber(candidate.answer, candidate.decimalPlaces),
              ],
              unit: candidate.unit,
            },
          }),
      solutionGuide: parseMathContent(candidate.explanationLatex, `${qId}-sol`),
      lockQuestionPosition: false,
      lockOptionShuffle: false,
      allowStatementShuffle: false,
      dependencyFlags: [],
      hasVisualAsset: false,
      answerConfirmed: false, // Giáo viên luôn cần rà soát & xác nhận trước khi xuất chính thức
      variantMeta: {
        parentQuestionId: resolvedParentId,
        templateId: template.id,
        variantCode,
        seed,
        parameterSignature: signature,
        parameterValues: candidate.params,
        verificationSummary: verifyCheck.proofText,
        verifiedAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    const variant: GeneratedQuestionVariant = {
      id: qId,
      variantCode,
      parentQuestionId: resolvedParentId,
      templateId: template.id,
      familyId: template.familyId,
      seed,
      parameterSignature: signature,
      parameterValues: candidate.params,
      question,
      correctValue: candidate.answer,
      correctFormatted,
      correctCanonicalKey,
      normalizedContentKey: buildNormalizedContentKey(candidate.stemLatex, correctCanonicalKey),
      correctOptionLabel,
      explanationText: candidate.explanationLatex,
      status: 'VARIANT_READY',
      verification,
      attemptsUsed: attempt,
      generatedAt: now,
    };

    return {
      ok: true,
      status: 'VARIANT_READY',
      variant,
      blockingReasons: [],
      attemptsUsed: attempt,
    };
  }

  return {
    ok: false,
    status: 'BLOCKED',
    blockingReasons: [
      GENERATION_FAILED_CONSTRAINTS_MSG,
      ...(lastReasons.length > 0
        ? Array.from(new Set(lastReasons)).slice(0, 3)
        : ['Không thể sinh biến thể hợp lệ sau tối đa số lần thử cho phép.']),
    ],
    attemptsUsed: maxTries,
  };
}
