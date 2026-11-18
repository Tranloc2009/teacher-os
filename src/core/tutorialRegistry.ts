import { APP_REGISTRY, AppDefinition, AppId } from './appRegistry';
import { TutorialDefinition, TutorialStepDef } from '../types/tutorial';

export const DESKTOP_OVERVIEW_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.desktop',
  version: '1.0.0',
  applicationId: 'desktop',
  title: 'Khám phá tổng quan TeacherOS Desktop',
  subtitle:
    'Làm quen màn hình làm việc chính và 4 khu vực công cụ quan trọng nhất dành cho giáo viên.',
  estimatedMinutes: 2,
  completionTitle: 'Bạn đã sẵn sàng sử dụng TeacherOS!',
  completionMessage:
    'Thầy/cô đã nắm được các khu vực chính của TeacherOS. Nếu cần xem lại hướng dẫn bất cứ lúc nào, hãy nhấn nút dấu ? ở thanh công cụ phía trên.',
  completionCtaLabel: 'Bắt đầu làm việc',
  steps: [
    {
      stepId: 'desktop-home',
      title: 'Bước 1 — TeacherOS Desktop',
      description:
        'Đây là màn hình làm việc chính của TeacherOS. Từ đây thầy/cô có thể mở nhanh các bài dạy đang soạn và truy cập từng công cụ giảng dạy.',
      target: 'desktop-hero',
      placement: 'bottom',
      actionType: 'info',
      hint: 'Nhấn vào dòng chữ TeacherOS 4.0 ở góc trên bên trái bất cứ lúc nào để quay lại màn hình này.',
      skippable: true,
    },
    {
      stepId: 'app-launcher',
      title: 'Bước 2 — App Launcher',
      description:
        'Nút "Ứng dụng" là nơi tập hợp toàn bộ công cụ trong TeacherOS để thầy/cô chuyển đổi nhanh chỉ với một cú nhấn.',
      target: 'topbar-app-launcher',
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'launcher-opened',
      hint: 'Hãy thử nhấn trực tiếp vào nút "Ứng dụng" đang sáng lên, hoặc chọn "Bỏ qua bước" nếu muốn xem tiếp.',
      skippable: true,
    },
    {
      stepId: 'my-workspace',
      title: 'Bước 3 — My Workspace',
      description:
        'Nơi sắp xếp giáo án, học liệu và ghi chú theo từng môn học, khối lớp dưới dạng sơ đồ trực quan dễ nhìn.',
      target: 'desktop-app-workspace',
      fallbackTargets: ['sidebar-app-workspace'],
      placement: 'auto',
      actionType: 'info',
      hint: 'Rất hữu ích khi thầy/cô muốn gom mọi tài liệu của cùng một chủ đề giảng dạy về một chỗ.',
      skippable: true,
      requiredAppId: 'workspace',
    },
    {
      stepId: 'lesson-studio',
      title: 'Bước 4 — Lesson Studio',
      description:
        'Công cụ soạn bộ tiết dạy theo 5 bước rõ ràng: từ mục tiêu bài học, hoạt động trên lớp đến câu hỏi và phiếu học tập phân hóa.',
      target: 'desktop-app-lesson-studio',
      fallbackTargets: ['sidebar-app-lesson-studio'],
      placement: 'auto',
      actionType: 'info',
      hint: 'TeacherOS sẽ tự lưu công việc của thầy/cô trên thiết bị này trong suốt quá trình soạn bài.',
      skippable: true,
      requiredAppId: 'lesson-studio',
    },
    {
      stepId: 'resource-vault',
      title: 'Bước 5 — Resource Vault',
      description:
        'Kho học liệu cá nhân lưu trữ sẵn các câu hỏi mẫu, đoạn ngữ liệu hay công thức để thầy/cô chèn nhanh vào giáo án chỉ với một chạm.',
      target: 'desktop-app-resource-vault',
      fallbackTargets: ['sidebar-app-resource-vault'],
      placement: 'auto',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'resource-vault',
    },
    {
      stepId: 'workflow-center',
      title: 'Bước 6 — Workflow Center',
      description:
        'Nơi quản lý công việc chuẩn bị trước, trong và sau giờ dạy dưới dạng danh sách từng bước hoặc sơ đồ công việc.',
      target: 'desktop-app-workflow-center',
      fallbackTargets: ['sidebar-app-workflow-center'],
      placement: 'auto',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
    {
      stepId: 'universal-search',
      title: 'Bước 7 — Universal Search',
      description:
        'Thanh tìm kiếm toàn hệ thống giúp tìm ngay bài dạy, mã câu hỏi, học liệu hay mở ứng dụng mà không cần nhớ nằm ở đâu.',
      target: 'topbar-search-desktop',
      fallbackTargets: ['topbar-search-mobile', 'desktop-search-btn'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mẹo dùng nhanh trên máy tính: nhấn phím Ctrl + K (hoặc Cmd + K) ở bất kỳ màn hình nào.',
      example: 'Thử gõ tên bài dạy hoặc mã câu hỏi như CB-01.',
      skippable: true,
    },
    {
      stepId: 'overview-complete',
      title: 'Bước 8 — Hoàn thành',
      description:
        'Bạn đã sẵn sàng sử dụng TeacherOS! Thầy/cô luôn có thể nhấn nút dấu ? ở thanh công cụ phía trên để xem lại hướng dẫn bất cứ lúc nào.',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
    },
  ],
};

export const WORKFLOW_CENTER_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.workflow-center',
  version: '1.0.0',
  applicationId: 'workflow-center',
  title: 'Hướng dẫn Workflow Center 2.0',
  subtitle:
    'Thiết kế quy trình chuẩn bị tiết dạy bằng sơ đồ trực quan, nối bước phụ thuộc và theo dõi tiến độ thực tế.',
  estimatedMinutes: 2,
  completionTitle: 'Hoàn thành hướng dẫn Workflow Center!',
  completionMessage:
    'Thầy/cô đã nắm cách tạo nhiệm vụ, nối bước phụ thuộc và cập nhật tiến độ thực tế. Có thể mở lại hướng dẫn bất cứ lúc nào từ nút Hướng dẫn trên thanh công cụ.',
  completionCtaLabel: 'Bắt đầu điều phối công việc',
  steps: [
    {
      stepId: 'wf-canvas-overview',
      title: 'Bước 1 — Sơ đồ quy trình trực quan',
      description:
        'Đây là Workflow Canvas: nơi sắp xếp các đầu việc chuẩn bị tiết dạy dưới dạng sơ đồ. Thầy/cô có thể kéo thả tự do, phóng to thu nhỏ và xem tiến độ hoàn thành ngay trên bảng.',
      target: 'workflow-canvas-viewport',
      fallbackTargets: ['workflow-canvas-toolbar'],
      placement: 'center',
      actionType: 'info',
      hint: 'Mọi thay đổi trên sơ đồ được tự động lưu ngay trên thiết bị này.',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
    {
      stepId: 'wf-add-task-or-template',
      title: 'Bước 2 — Thêm nhiệm vụ hoặc dùng Mẫu quy trình',
      description:
        'Nhấn "Mẫu quy trình" để chèn nhanh một quy trình chuẩn bị tiết dạy có sẵn, hoặc bấm dấu + ở cột "Thư viện Node" bên trái để thêm từng nhiệm vụ mới.',
      target: 'workflow-canvas-smart-builder',
      fallbackTargets: ['workflow-canvas-add-task', 'workflow-canvas-mobile-library'],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'workflow-task-or-template-used',
      hint: 'Hãy thử nhấn vào nút "Mẫu quy trình" đang sáng lên (hoặc thêm một nhiệm vụ từ cột trái).',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
    {
      stepId: 'wf-connect-dependency',
      title: 'Bước 3 — Nối các bước phụ thuộc nhau',
      description:
        'Chọn kiểu liên kết "Phụ thuộc" tại đây, sau đó kéo từ chấm tròn xanh trên một thẻ công việc nối sang thẻ tiếp theo để đánh dấu bước nào cần hoàn thành trước.',
      target: 'workflow-canvas-edge-type',
      fallbackTargets: ['workflow-canvas-toolbar'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Khi bước trước chưa xong, TeacherOS sẽ tự báo bước sau đang chờ để thầy/cô dễ kiểm soát.',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
    {
      stepId: 'wf-track-progress',
      title: 'Bước 4 — Cập nhật trạng thái & Xem tiến độ',
      description:
        'Bảng bên phải hiển thị tỷ lệ % công việc đã hoàn thành thực tế. Khi nhấn vào một thẻ trên sơ đồ, thầy/cô có thể đổi trạng thái sang Đang làm, Hoàn thành hoặc Bị chặn.',
      target: 'workflow-canvas-inspector',
      fallbackTargets: ['workflow-canvas-mobile-inspector'],
      placement: 'left',
      actionType: 'info',
      hint: 'Mẹo nhanh: thầy/cô cũng có thể nhấn trực tiếp vào ô tròn ở góc thẻ nhiệm vụ để đánh dấu xong ngay.',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
    {
      stepId: 'wf-layout-and-classic',
      title: 'Bước 5 — Dàn trang gọn & Bảng 3 giai đoạn',
      description:
        'Nếu sơ đồ nhiều thẻ, nhấn "Dàn trang" để hệ thống tự xếp ngay ngắn. Nút "Bảng 3 giai đoạn" giúp chuyển nhanh giữa sơ đồ và danh sách Trước – Trong – Sau tiết dạy.',
      target: 'workflow-canvas-classic-switch',
      fallbackTargets: ['workflow-canvas-layout-group'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Hai chế độ dùng chung dữ liệu, thầy/cô chuyển qua lại bất cứ lúc nào mà không mất công việc.',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
    {
      stepId: 'wf-complete',
      title: 'Bước 6 — Hoàn thành',
      description: 'Thầy/cô đã nắm vững Workflow Center 2.0!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'workflow-center',
    },
  ],
};

export const WORKSPACE_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.workspace',
  version: '1.0.0',
  applicationId: 'workspace',
  title: 'Hướng dẫn My Workspace — Sơ đồ cây bài dạy',
  subtitle:
    'Tổ chức bài dạy, học liệu, nhật ký và đề kiểm tra thành sơ đồ cây trực quan.',
  estimatedMinutes: 2,
  completionTitle: 'Hoàn thành hướng dẫn My Workspace!',
  completionMessage:
    'Thầy/cô đã biết cách dựng sơ đồ cây, gắn tài liệu thật và sắp xếp nhánh gọn gàng. Có thể xem lại bất cứ lúc nào từ nút Hướng dẫn trên thanh công cụ.',
  completionCtaLabel: 'Bắt đầu sắp xếp bài dạy',
  steps: [
    {
      stepId: 'ws-canvas-overview',
      title: 'Bước 1 — Bản đồ tư duy chuyên môn',
      description:
        'Đây là Workspace Canvas: nơi gom mọi giáo án, học liệu, ghi chú và đề kiểm tra của cùng một chủ đề hoặc khối lớp lên một sơ đồ cây dễ theo dõi.',
      target: 'workspace-canvas-viewport',
      fallbackTargets: ['workspace-canvas-toolbar'],
      placement: 'center',
      actionType: 'info',
      hint: 'Kéo nền sơ đồ để di chuyển góc nhìn hoặc lăn chuột để phóng to, thu nhỏ.',
      skippable: true,
      requiredAppId: 'workspace',
    },
    {
      stepId: 'ws-build-tree-or-branch',
      title: 'Bước 2 — Dựng cây bài dạy hoặc thêm nhánh mới',
      description:
        'Nhấn "Dựng cây bài dạy" để hệ thống tạo sẵn một nhánh gồm Bộ tiết dạy, Học liệu và Nhật ký liên quan — hoặc bấm nút "+ Con" trên bất kỳ thẻ nào để mở rộng thêm nhánh.',
      target: 'workspace-canvas-smart-builder',
      fallbackTargets: [
        'workspace-canvas-node-quick-add',
        'workspace-canvas-mobile-library',
      ],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'workspace-tree-or-branch-added',
      hint: 'Hãy thử nhấn "Dựng cây bài dạy" đang sáng lên hoặc bấm "+ Con" trên một thẻ.',
      skippable: true,
      requiredAppId: 'workspace',
    },
    {
      stepId: 'ws-link-documents',
      title: 'Bước 3 — Gắn & mở trực tiếp tài liệu TeacherOS',
      description:
        'Ở khung bên trái, chuyển sang thẻ "Tài liệu" để kéo thả Giáo án, Học liệu, Nhật ký hay Đề Toán vào sơ đồ. Khi nhấn nút "Mở" trên thẻ, tài liệu gốc sẽ mở ra ngay.',
      target: 'workspace-canvas-sidebar',
      fallbackTargets: ['workspace-canvas-mobile-library'],
      placement: 'right',
      actionType: 'info',
      hint: 'Thẻ trên sơ đồ chỉ là đường dẫn tới tài liệu gốc nên xóa thẻ khỏi sơ đồ sẽ không làm mất dữ liệu bài dạy.',
      skippable: true,
      requiredAppId: 'workspace',
    },
    {
      stepId: 'ws-layout-and-focus',
      title: 'Bước 4 — Dàn trang cây, Thu gọn & Tập trung nhánh',
      description:
        'Chọn kiểu bố cục Cây dọc, Cây ngang hoặc Mind Map rồi bấm "Dàn trang" để tự căn chỉnh đẹp mắt. Khi chọn một thẻ, bảng bên phải còn hỗ trợ "Tập trung nhánh" để xem riêng cụm bài dạy đó.',
      target: 'workspace-canvas-layout-group',
      fallbackTargets: ['workspace-canvas-toolbar'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Thầy/cô cũng có thể chuyển sang "Danh sách & Inspector" bất cứ lúc nào để rà soát hồ sơ sẵn sàng in A4.',
      skippable: true,
      requiredAppId: 'workspace',
    },
    {
      stepId: 'ws-complete',
      title: 'Bước 5 — Hoàn thành',
      description:
        'Thầy/cô đã sẵn sàng tổ chức chuyên môn trực quan với My Workspace!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'workspace',
    },
  ],
};

export const LESSON_STUDIO_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.lesson-studio',
  version: '1.0.0',
  applicationId: 'lesson-studio',
  title: 'Hướng dẫn Lesson Studio — Soạn bộ tiết dạy 5 bước',
  subtitle:
    'Soạn mục tiêu, chuỗi hoạt động 5–15 phút, ngân hàng câu hỏi 3 mức và phiếu Rubric đánh giá.',
  estimatedMinutes: 3,
  completionTitle: 'Hoàn thành hướng dẫn Lesson Studio!',
  completionMessage:
    'Thầy/cô đã nắm quy trình soạn trọn bộ tiết dạy 5 bước. Mọi thay đổi được tự lưu trên thiết bị và sẵn sàng chuyển sang Print Studio để in A4.',
  completionCtaLabel: 'Tiếp tục soạn bài',
  steps: [
    {
      stepId: 'ls-overview',
      title: 'Bước 1 — Không gian soạn bài 5 bước',
      description:
        'Lesson Studio giúp thầy/cô chuẩn bị trọn bộ một tiết dạy theo trình tự sư phạm rõ ràng từ mục tiêu bài học đến bản in A4.',
      target: 'ls-wizard-nav',
      fallbackTargets: ['ls-mode-tabs'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mọi chỉnh sửa đều được tự lưu tự động xuống máy và có nút Hoàn tác / Làm lại ở góc phải.',
      skippable: true,
      requiredAppId: 'lesson-studio',
    },
    {
      stepId: 'ls-switch-step',
      title: 'Bước 2 — Chuyển linh hoạt giữa 5 bước soạn bài',
      description:
        'Nhấn trực tiếp vào bất kỳ bước nào trên thanh 5 bước (Hoạt động 5–15p, Câu hỏi & Phân bổ, Biên tập Rubric hoặc Xem trước A4) để mở phần nội dung tương ứng.',
      target: 'ls-wizard-nav',
      fallbackTargets: ['ls-mode-tabs'],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'lesson-wizard-step-changed',
      hint: 'Hãy thử nhấn vào "2. Hoạt động 5–15p" hoặc "3. Câu hỏi & Phân bổ" đang sáng lên.',
      skippable: true,
      requiredAppId: 'lesson-studio',
    },
    {
      stepId: 'ls-editor-workspace',
      title: 'Bước 3 — Vùng biên tập chi tiết & Kiểm tra phân bổ',
      description:
        'Tại đây thầy/cô nhập mục tiêu, phân chia thời lượng từng hoạt động và gắn câu hỏi theo 3 mức Cơ bản – Vận dụng – Mở rộng cho 3 mẫu phiếu.',
      target: 'ls-wizard-content',
      fallbackTargets: ['ls-wizard-nav'],
      placement: 'top',
      actionType: 'info',
      hint: 'Nếu cần quay lại thao tác trước đó, hãy dùng nút Hoàn tác (Undo) ngay phía trên bảng bước.',
      skippable: true,
      requiredAppId: 'lesson-studio',
    },
    {
      stepId: 'ls-library-and-new',
      title: 'Bước 4 — Quản lý Kho bộ tiết dạy & Tạo bài mới',
      description:
        'Thẻ "Kho bộ tiết dạy" lưu toàn bộ bài đã soạn để thầy/cô tìm kiếm, nhân bản dạy lớp song song hoặc tạo nhanh một bộ tiết dạy mới.',
      target: 'ls-tab-library',
      fallbackTargets: ['ls-new-pack-btn', 'ls-mode-tabs'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Có thể chuyển qua lại giữa Trình soạn và Kho mà không mất nội dung đang nhập.',
      skippable: true,
      requiredAppId: 'lesson-studio',
    },
    {
      stepId: 'ls-complete',
      title: 'Bước 5 — Hoàn thành',
      description:
        'Thầy/cô đã sẵn sàng thiết kế giáo án và bộ phiếu bài tập chuẩn A4 trong Lesson Studio!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'lesson-studio',
    },
  ],
};

export const PRINT_STUDIO_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.print-studio',
  version: '1.0.0',
  applicationId: 'print-studio',
  title: 'Hướng dẫn Print Studio 2.0 — Rà soát & In A4',
  subtitle:
    'Kiểm tra chất lượng tài liệu trước khi in bằng Document Inspector, đổi nhanh lề A4 và xuất PDF từng phần.',
  estimatedMinutes: 2,
  completionTitle: 'Hoàn thành hướng dẫn Print Studio 2.0!',
  completionMessage:
    'Thầy/cô đã biết cách kiểm tra bộ tài liệu bằng Document Inspector, tinh chỉnh lề A4 và chọn đúng phiếu cần in.',
  completionCtaLabel: 'Sẵn sàng in tài liệu',
  steps: [
    {
      stepId: 'ps-select-pack',
      title: 'Bước 1 — Chọn bộ tiết dạy cần xuất bản',
      description:
        'Chọn bất kỳ bộ tiết dạy nào trong danh sách để xem trước đồng bộ cả Giáo án, 3 mẫu phiếu A/B/C, Rubric quá trình và Đáp án giáo viên.',
      target: 'ps-pack-select',
      fallbackTargets: ['ps-topbar'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Nếu cần sửa nội dung bài dạy, nhấn nút "Chỉnh sửa trong Lesson Studio" ngay bên phải.',
      skippable: true,
      requiredAppId: 'print-studio',
    },
    {
      stepId: 'ps-inspector-or-margins',
      title: 'Bước 2 — Đổi nhanh lề A4 hoặc bật Document Inspector',
      description:
        'Thử nhấn một mức lề nhanh (Hẹp 10mm / Chuẩn 15mm / Rộng 20mm) hoặc nhấn nút "Document Inspector" để bật/tắt bảng rà soát 6 hạng mục trước khi in.',
      target: 'ps-margin-presets',
      fallbackTargets: ['ps-inspector-toggle', 'ps-topbar'],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'print-inspector-or-margin-used',
      hint: 'Hãy thử bấm "Chuẩn 15mm", "Hẹp 10mm" hoặc nút "Document Inspector".',
      skippable: true,
      requiredAppId: 'print-studio',
    },
    {
      stepId: 'ps-inspector-check',
      title: 'Bước 3 — Rà soát chất lượng với Document Inspector',
      description:
        'Bảng kiểm tra cho biết ngay bài dạy đã đủ mục tiêu, khớp tổng thời lượng tiết học, đủ câu hỏi cho cả 3 phiếu và đủ 100% tỷ trọng Rubric hay chưa.',
      target: 'ps-inspector-panel',
      fallbackTargets: ['ps-inspector-toggle'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mục nào còn dấu chấm than vàng sẽ giúp thầy/cô biết chính xác cần bổ sung phần nào trước giờ lên lớp.',
      skippable: true,
      requiredAppId: 'print-studio',
    },
    {
      stepId: 'ps-doc-tabs-and-print',
      title: 'Bước 4 — Chọn từng tài liệu & In / Lưu PDF (A4)',
      description:
        'Chọn xem riêng Giáo án, từng Phiếu A/B/C, Rubric hay Đáp án giáo viên rồi nhấn "In / Lưu PDF (A4)" để in trực tiếp hoặc lưu thành tệp PDF.',
      target: 'ps-print-actions',
      fallbackTargets: ['ps-doc-tabs', 'ps-preview-card'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Khung bên dưới hiển thị đúng khổ giấy A4 (210 × 297 mm) kèm lề thầy/cô vừa chọn.',
      skippable: true,
      requiredAppId: 'print-studio',
    },
    {
      stepId: 'ps-complete',
      title: 'Bước 5 — Hoàn thành',
      description:
        'Thầy/cô đã nắm toàn bộ quy trình kiểm tra và xuất bản A4 trong Print Studio 2.0!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'print-studio',
    },
  ],
};

export const MATH_EXAM_MIXER_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.math-mixer',
  version: '2.0.0',
  applicationId: 'math-mixer',
  title: 'Hướng dẫn Exam Mixer Pro 6.0 — Trộn đề đa môn an toàn',
  subtitle:
    'Chọn hồ sơ môn học, nhập đề Word (.docx) hoặc dán văn bản, khóa vị trí 5 lớp, đối soát mã đề và xuất DOCX/ZIP/PDF A4.',
  estimatedMinutes: 3,
  completionTitle: 'Hoàn thành hướng dẫn Exam Mixer Pro 6.0!',
  completionMessage:
    'Thầy/cô đã nắm quy trình 5 bước trộn đề đa môn an toàn tuyệt đối: bảo toàn 100% công thức, khóa ngữ liệu linh hoạt và xuất bộ mã đề Word/ZIP/PDF đã kiểm chứng.',
  completionCtaLabel: 'Bắt đầu trộn đề ngay',
  steps: [
    {
      stepId: 'math-step-overview',
      title: 'Bước 1 — Nguyên tắc Zero Mathematical Corruption',
      description:
        'Exam Mixer Pro 6.0 hỗ trợ 12 môn học THCS/THPT với 10 dạng câu hỏi. Mọi công thức Toán/Lý/Hóa/Sinh, đoạn văn Đọc hiểu hay mã nguồn Tin học được lưu thành khối bất biến theo ID.',
      target: 'math-header',
      fallbackTargets: ['math-step-tabs'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mọi thao tác xử lý, trộn đề và xuất Word/ZIP diễn ra 100% ngoại tuyến ngay trên máy thầy/cô.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-subject-profile',
      title: 'Bước 2 — Chọn Môn học & Hồ sơ bảo vệ đặc thù',
      description:
        'Chọn đúng môn học tại đây để kích hoạt Hồ sơ bảo vệ tương ứng (VD: giữ chỉ số ion Hóa học, cực DNA Sinh học, ngắt dòng thơ Ngữ văn, IPA Tiếng Anh hay thụt lề code Tin học).',
      target: 'math-subject-select',
      fallbackTargets: ['math-step-tabs', 'math-header'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Khi nhập file .docx hoặc dán đề, hệ thống cũng tự phân tích tín hiệu để gợi ý môn học cho thầy/cô.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-import-source',
      title: 'Bước 3 — Nhập đề từ Word (.docx), dán văn bản hoặc JSON',
      description:
        'Nhấn "Nhập đề thông minh" để tải trực tiếp đề thi Word (.docx) giữ nguyên công thức OMML/chỉ số trên dưới/hình ảnh, hoặc dán văn bản/bảng đáp án nhanh.',
      target: 'math-import-btn',
      fallbackTargets: ['math-subject-select', 'math-header'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Các câu có hình ảnh hoặc bảng số liệu lỗi đều được gắn nhãn cảnh báo ngay trên danh sách câu hỏi.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-lock-controls',
      title: 'Bước 4 — Universal Lock: Khóa câu, khóa phương án & nhóm ngữ liệu',
      description:
        'Dùng thanh khóa để giữ cố định vị trí câu, khóa riêng từng phương án A/B/C/D hoặc gom các câu Đọc hiểu / thí nghiệm chung dữ kiện thành nhóm di chuyển nguyên khối.',
      target: 'math-lock-strip',
      fallbackTargets: ['math-step-tabs', 'math-header'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Những câu chứa "Cả A và B đều đúng" hoặc "All of the above" được tự động phát hiện và bảo vệ.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-confirm-step',
      title: 'Bước 5 — Rà soát & Xác nhận đáp án gốc (Bước 2)',
      description:
        'Kiểm tra lại toàn bộ đáp án đúng (1 đáp án, nhiều đáp án, Đúng/Sai a/b/c/d, điền khuyết, ghép đôi, sắp xếp) rồi nhấn nút xác nhận để mở khóa bước trộn.',
      target: 'math-confirm-answers',
      fallbackTargets: ['math-step-tabs'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mọi mã đề trộn sau này sẽ ánh xạ chính xác theo ID từ bộ đáp án gốc thầy/cô đã xác nhận.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-mix-rules',
      title: 'Bước 6 — Chọn mức trộn (0–4), tùy chỉnh Hồ sơ môn & Số lượng mã đề',
      description:
        'Chọn mức trộn 0–4, tùy chỉnh quy tắc theo môn và chọn nhanh 2, 4, 8, 10, 20, 40, 50, 100 mã đề (hỗ trợ xử lý bất đồng bộ có nút Hủy).',
      target: 'math-mix-levels',
      fallbackTargets: ['math-step-tabs'],
      placement: 'right',
      actionType: 'info',
      hint: 'Mã Seed xác định giúp thầy/cô tái tạo lại chính xác bộ mã đề đã phát bất cứ lúc nào.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-compare-codes',
      title: 'Bước 7 — Chuyển bước & Đối soát Đề gốc ↔ Mã đề',
      description:
        'Nhấn trực tiếp vào thanh 5 bước (VD: "4. Kiểm tra & So sánh") để đối chiếu câu hỏi, bảng ánh xạ hoán vị theo ID, so sánh song song 2 mã đề hoặc xem bảng đáp án tổng hợp.',
      target: 'math-step-tabs',
      fallbackTargets: ['math-header'],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'math-step-nav-clicked',
      hint: 'Hãy thử nhấn vào một bước trên thanh 5 bước. Nếu phát hiện sai lệch hash, mã đề sẽ bị gắn cờ BLOCKED ngay.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-export-formats',
      title: 'Bước 8 — Kiểm chứng hậu xuất & Xuất ZIP / DOCX / CSV / PDF A4',
      description:
        'Hệ thống rà soát toàn bộ hạng mục toàn vẹn trước khi mở khóa Trung tâm xuất đề: tải trọn bộ .ZIP (đề học sinh .DOCX 0% rò rỉ đáp án + file Đáp án/Ánh xạ .DOCX + .CSV) hoặc In A4 / PDF.',
      target: 'math-export-hub',
      fallbackTargets: ['math-export-gate', 'math-step-tabs'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mỗi gói ZIP xuất ra đều được OOXML Parser đọc ngược kiểm chứng một lần nữa trước khi tải về máy.',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
    {
      stepId: 'math-complete',
      title: 'Bước 9 — Hoàn thành',
      description:
        'Thầy/cô đã sẵn sàng sử dụng trọn bộ Exam Mixer Pro 6.0 cho mọi môn học THCS và THPT!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'math-mixer',
    },
  ],
};

export const RESOURCE_VAULT_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.resource-vault',
  version: '1.0.0',
  applicationId: 'resource-vault',
  title: 'Hướng dẫn Resource Vault — Kho học liệu chèn 1 chạm',
  subtitle:
    'Tìm kiếm, phân loại học liệu giảng dạy cá nhân và chèn ngay vào bộ tiết dạy đang mở.',
  estimatedMinutes: 2,
  completionTitle: 'Hoàn thành hướng dẫn Resource Vault!',
  completionMessage:
    'Thầy/cô đã biết cách phân loại và tái sử dụng học liệu chỉ với một lần nhấn để rút ngắn thời gian soạn bài.',
  completionCtaLabel: 'Khám phá kho học liệu',
  steps: [
    {
      stepId: 'rv-overview',
      title: 'Bước 1 — Kho học liệu tái sử dụng cá nhân',
      description:
        'Resource Vault lưu trữ các mẫu câu hỏi hay, hoạt động lớp 5–15 phút, công thức và ngữ liệu để dùng lại cho nhiều lớp và nhiều năm học.',
      target: 'rv-header',
      placement: 'bottom',
      actionType: 'info',
      hint: 'Tên bộ tiết dạy đang mở hiển thị ngay ở phần đầu để thầy/cô biết tài nguyên sẽ chèn vào bài nào.',
      skippable: true,
      requiredAppId: 'resource-vault',
    },
    {
      stepId: 'rv-filter-search',
      title: 'Bước 2 — Lọc nhanh theo loại học liệu',
      description:
        'Nhấn vào một nút lọc (Mẫu câu hỏi, Hoạt động 5–15p, Công thức / Sơ đồ, Ngữ liệu) hoặc gõ từ khóa để tìm đúng học liệu cần dùng.',
      target: 'rv-filter-bar',
      fallbackTargets: ['rv-header'],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'rv-filter-changed',
      hint: 'Hãy thử bấm vào thẻ "Mẫu câu hỏi" hoặc "Hoạt động 5–15p".',
      skippable: true,
      requiredAppId: 'resource-vault',
    },
    {
      stepId: 'rv-add-resource',
      title: 'Bước 3 — Lưu thêm học liệu tâm đắc',
      description:
        'Nhấn "+ Thêm học liệu mới" bất cứ lúc nào để lưu câu hỏi mở rộng, tình huống thực tế hoặc ghi chú sư phạm vào kho riêng.',
      target: 'rv-add-btn',
      fallbackTargets: ['rv-header'],
      placement: 'bottom',
      actionType: 'info',
      hint: 'Mỗi học liệu có thể gắn môn học, khối lớp và thẻ từ khóa để lần sau tìm thấy ngay.',
      skippable: true,
      requiredAppId: 'resource-vault',
    },
    {
      stepId: 'rv-one-click-insert',
      title: 'Bước 4 — Chèn 1 chạm vào bộ tiết dạy đang mở',
      description:
        'Trên từng thẻ học liệu, nút "Chèn vào Ngân hàng câu hỏi" hoặc "Chèn thành Hoạt động bài dạy" sẽ đưa ngay nội dung đó sang Lesson Studio.',
      target: 'rv-insert-btn',
      fallbackTargets: ['rv-grid', 'rv-header'],
      placement: 'top',
      actionType: 'info',
      hint: 'Dữ liệu gốc trong kho vẫn được giữ nguyên vẹn để dùng cho những bài dạy khác.',
      skippable: true,
      requiredAppId: 'resource-vault',
    },
    {
      stepId: 'rv-complete',
      title: 'Bước 5 — Hoàn thành',
      description:
        'Thầy/cô đã sẵn sàng xây dựng và sử dụng kho học liệu cá nhân trong Resource Vault!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'resource-vault',
    },
  ],
};

export const TEACHING_JOURNAL_TUTORIAL: TutorialDefinition = {
  tutorialId: 'tutorial.teaching-journal',
  version: '1.0.0',
  applicationId: 'teaching-journal',
  title: 'Hướng dẫn Teaching Journal — Nhật ký rút kinh nghiệm',
  subtitle:
    'Ghi lại nhịp độ tiết dạy thực tế và áp dụng cải tiến thẳng vào giáo án cho lớp tiếp theo.',
  estimatedMinutes: 2,
  completionTitle: 'Hoàn thành hướng dẫn Teaching Journal!',
  completionMessage:
    'Thầy/cô đã nắm cách ghi nhận phản hồi sau tiết dạy và biến kinh nghiệm thực tế thành cải tiến trực tiếp trong bài dạy.',
  completionCtaLabel: 'Bắt đầu ghi nhật ký',
  steps: [
    {
      stepId: 'tj-overview',
      title: 'Bước 1 — Nhật ký giảng dạy gắn với từng bài dạy',
      description:
        'Teaching Journal giúp thầy/cô ghi nhanh điều gì hiệu quả, chỗ nào học sinh còn vướng và thời lượng thực tế ngay sau khi rời lớp.',
      target: 'tj-header',
      placement: 'bottom',
      actionType: 'info',
      hint: 'Rất hữu ích khi dạy cùng một bài ở nhiều lớp khác nhau như 8A1, 8A2, 8A3.',
      skippable: true,
      requiredAppId: 'teaching-journal',
    },
    {
      stepId: 'tj-open-form',
      title: 'Bước 2 — Ghi nhật ký tiết dạy mới',
      description:
        'Nhấn nút "+ Ghi nhật ký tiết dạy" để mở biểu mẫu ghi nhanh lớp dạy, ngày dạy và đánh giá nhịp độ Thiếu giờ / Vừa khít / Dư giờ.',
      target: 'tj-add-btn',
      fallbackTargets: ['tj-header'],
      placement: 'bottom',
      actionType: 'click',
      completionEvent: 'tj-form-opened',
      hint: 'Hãy thử nhấn vào nút "+ Ghi nhật ký tiết dạy" đang sáng lên.',
      skippable: true,
      requiredAppId: 'teaching-journal',
    },
    {
      stepId: 'tj-reflection-cards',
      title: 'Bước 3 — Theo dõi 3 phần rút kinh nghiệm rõ ràng',
      description:
        'Mỗi thẻ nhật ký tách bạch Điểm hiệu quả, Vướng mắc của học sinh và Điều chỉnh cụ thể cho lớp dạy tiếp theo.',
      target: 'tj-cards',
      fallbackTargets: ['tj-header'],
      placement: 'top',
      actionType: 'info',
      hint: 'Nhấn vào tên Bài dạy ở góc phải thẻ để mở lại đúng giáo án đó trong Lesson Studio.',
      skippable: true,
      requiredAppId: 'teaching-journal',
    },
    {
      stepId: 'tj-apply-note',
      title: 'Bước 4 — Áp dụng ghi chú cải tiến vào bài dạy',
      description:
        'Nhấn "Áp dụng ghi chú cải tiến vào bộ tiết dạy" để đưa thẳng điều chỉnh từ nhật ký vào phần Lưu ý giáo viên của bộ tiết dạy liên kết.',
      target: 'tj-apply-btn',
      fallbackTargets: ['tj-cards', 'tj-header'],
      placement: 'top',
      actionType: 'info',
      hint: 'Kinh nghiệm sau tiết dạy sẽ nằm sẵn trong giáo án ở lần giảng dạy tiếp theo.',
      skippable: true,
      requiredAppId: 'teaching-journal',
    },
    {
      stepId: 'tj-complete',
      title: 'Bước 5 — Hoàn thành',
      description:
        'Thầy/cô đã hoàn thành hướng dẫn sử dụng Teaching Journal!',
      target: 'center',
      placement: 'center',
      actionType: 'info',
      skippable: true,
      requiredAppId: 'teaching-journal',
    },
  ],
};

export const TUTORIAL_REGISTRY: TutorialDefinition[] = [
  DESKTOP_OVERVIEW_TUTORIAL,
  LESSON_STUDIO_TUTORIAL,
  PRINT_STUDIO_TUTORIAL,
  WORKSPACE_TUTORIAL,
  RESOURCE_VAULT_TUTORIAL,
  WORKFLOW_CENTER_TUTORIAL,
  TEACHING_JOURNAL_TUTORIAL,
  MATH_EXAM_MIXER_TUTORIAL,
];

export function getActiveTutorialSteps(
  tutorial: TutorialDefinition,
  apps: AppDefinition[] = APP_REGISTRY
): TutorialStepDef[] {
  const readyAppIds = new Set(
    apps.filter((app) => app.status === 'ready').map((app) => app.id)
  );
  return tutorial.steps.filter((step) => {
    if (!step.requiredAppId) return true;
    return readyAppIds.has(step.requiredAppId);
  });
}

export function getTutorialById(
  tutorialId: string,
  apps: AppDefinition[] = APP_REGISTRY
): TutorialDefinition | undefined {
  const found = TUTORIAL_REGISTRY.find((t) => t.tutorialId === tutorialId);
  if (!found) return undefined;
  return {
    ...found,
    steps: getActiveTutorialSteps(found, apps),
  };
}

export function getTutorialForApp(
  appId: AppId,
  apps: AppDefinition[] = APP_REGISTRY
): TutorialDefinition | undefined {
  const found = TUTORIAL_REGISTRY.find((t) => t.applicationId === appId);
  if (!found) return undefined;
  return {
    ...found,
    steps: getActiveTutorialSteps(found, apps),
  };
}

export function canAdvanceFromStep(
  step: TutorialStepDef | undefined,
  actionCompleted: boolean
): boolean {
  if (!step) return false;
  if (step.actionType === 'info') return true;
  return actionCompleted;
}
