import { hash } from "bcryptjs";
import { db } from "../src/lib/db";

// ─── Seed data ──────────────────────────────────────────────────────────────

const ORG_NAME = "سازمان نمونه";

const ADMIN_USER = {
  email: "admin@example.com",
  password: "admin123",
  name: "مدیر سیستم",
  role: "ADMIN" as const,
};

const EMPLOYEE_USER = {
  email: "employee@example.com",
  password: "emp123",
  name: "کاربر عادی",
  role: "EMPLOYEE" as const,
};

interface SeedRule {
  code: string;
  title: string;
  body: string;
  keywords: string[];
  patterns: string[];
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category: string;
}

const SEED_RULES: SeedRule[] = [
  {
    code: "R-001",
    title: "اطلاعات حقوق و دستمزد",
    body: "اشتراک‌گذاری اطلاعات مربوط به حقوق، مزایا، پاداش و فیش حقوقی کارکنان با مدل‌های هوش مصنوعی خارجی ممنوع است.",
    keywords: ["حقوق", "دستمزد", "فیش حقوقی", "پاداش", "مزایا"],
    patterns: ["حقوق.*ماه(یانه)?", "فیش.*حقوق"],
    severity: "CRITICAL",
    category: "اطلاعات مالی",
  },
  {
    code: "R-002",
    title: "کد ملی و اطلاعات هویتی",
    body: "ارسال کد ملی، شماره شناسنامه و سایر اطلاعات هویتی پرسنلی به سرویس‌های خارجی اکیداً ممنوع است.",
    keywords: ["کد ملی", "شماره ملی", "شناسنامه", "کدملی", "اطلاعات هویتی"],
    patterns: ["\\d{10}", "کد.*ملی"],
    severity: "CRITICAL",
    category: "داده‌های شخصی",
  },
  {
    code: "R-003",
    title: "اطلاعات حساب بانکی",
    body: "اطلاعات حساب‌های بانکی شامل شماره شبا، شماره کارت و موجودی حساب نباید به اشتراک گذاشته شود.",
    keywords: ["شماره شبا", "شماره کارت", "حساب بانکی", "IR\\d+", "شبا"],
    patterns: ["IR[0-9]{24}", "\\d{4}-\\d{4}-\\d{4}-\\d{4}", "شماره.*شبا"],
    severity: "HIGH",
    category: "اطلاعات مالی",
  },
  {
    code: "R-004",
    title: "قراردادها و صورت‌جلسات",
    body: "محتوای قراردادهای تجاری، صورت‌جلسات هیئت‌مدیره و مذاکرات محرمانه نباید به مدل‌های خارجی ارسال شود.",
    keywords: ["قرارداد", "صورت‌جلسه", "هیئت مدیره", "مذاکره", "تفاهم‌نامه"],
    patterns: ["قرارداد.*تجاری", "صورت.*جلسه"],
    severity: "HIGH",
    category: "محرمانگی",
  },
  {
    code: "R-005",
    title: "کلیدها و توکن‌های امنیتی",
    body: "کلیدهای API، توکن‌های دسترسی، رمزهای عبور و هرگونه اعتبارنامه امنیتی نباید به خارج از سازمان ارسال شود.",
    keywords: ["کلید API", "توکن", "رمز عبور", "API Key", "اعتبارنامه"],
    patterns: [
      "sk-[a-zA-Z0-9]+",
      "AKIA[A-Z0-9]+",
      "password\\s*=",
      "-----BEGIN.*PRIVATE KEY-----",
    ],
    severity: "CRITICAL",
    category: "امنیت",
  },
  {
    code: "R-006",
    title: "اطلاعات مشتریان",
    body: "داده‌های شخصی مشتریان شامل نام، آدرس، شماره تماس و تاریخچه خرید نباید به سرویس‌های خارجی ارسال شود.",
    keywords: ["مشتری", "آدرس مشتری", "شماره تماس مشتری", "تاریخچه خرید", "اطلاعات مشتری"],
    patterns: ["لیست.*مشتری", "اطلاعات.*مشتریان", "پایگاه.*مشتری"],
    severity: "HIGH",
    category: "داده‌های شخصی",
  },
  {
    code: "R-007",
    title: "استراتژی و برنامه‌ریزی سازمان",
    body: "اسناد استراتژیک، برنامه‌های توسعه، بودجه‌ریزی بلندمدت و اهداف سازمانی محرمانه هستند.",
    keywords: ["استراتژی", "برنامه‌ریزی", "بودجه", "اهداف سازمانی", "نقشه راه"],
    patterns: ["استراتژی.*سازمان", "برنامه.*توسعه"],
    severity: "MEDIUM",
    category: "محرمانگی",
  },
  {
    code: "R-008",
    title: "اطلاعات داخلی غیرمجاز",
    body: "ارسال اطلاعات داخلی سازمان بدون مجوز رسمی به هر پلتفرم خارجی ممنوع است. این شامل مستندات، گزارش‌ها و داده‌های عملیاتی می‌شود.",
    keywords: ["اطلاعات داخلی", "گزارش داخلی", "مستندات سازمانی", "داده عملیاتی", "فرآیند داخلی"],
    patterns: ["گزارش.*داخلی", "مستندات.*سازمان", "اطلاعات.*داخلی"],
    severity: "MEDIUM",
    category: "محرمانگی",
  },
];

// ─── Main seed function ─────────────────────────────────────────────────────

async function main() {
  console.log("🌱 شروع عملیات seed ...");

  // ── 1. Organization ───────────────────────────────────────────────────
  let org = await db.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    org = await db.organization.create({ data: { name: ORG_NAME } });
    console.log(`  ✅ سازمان ایجاد شد: ${org.name} (${org.id})`);
  } else {
    console.log(`  ⏭️  سازمان از قبل وجود دارد: ${org.name} (${org.id})`);
  }

  // ── 2. Admin user ─────────────────────────────────────────────────────
  let adminUser = await db.user.findUnique({ where: { email: ADMIN_USER.email } });
  if (!adminUser) {
    const passwordHash = await hash(ADMIN_USER.password, 10);
    adminUser = await db.user.create({
      data: {
        email: ADMIN_USER.email,
        name: ADMIN_USER.name,
        passwordHash,
        role: ADMIN_USER.role,
        organizationId: org.id,
      },
    });
    console.log(`  ✅ مدیر ایجاد شد: ${adminUser.email}`);
  } else {
    console.log(`  ⏭️  مدیر از قبل وجود دارد: ${adminUser.email}`);
  }

  // ── 3. Employee user ──────────────────────────────────────────────────
  let employeeUser = await db.user.findUnique({ where: { email: EMPLOYEE_USER.email } });
  if (!employeeUser) {
    const passwordHash = await hash(EMPLOYEE_USER.password, 10);
    employeeUser = await db.user.create({
      data: {
        email: EMPLOYEE_USER.email,
        name: EMPLOYEE_USER.name,
        passwordHash,
        role: EMPLOYEE_USER.role,
        organizationId: org.id,
      },
    });
    console.log(`  ✅ کاربر ایجاد شد: ${employeeUser.email}`);
  } else {
    console.log(`  ⏭️  کاربر از قبل وجود دارد: ${employeeUser.email}`);
  }

  // ── 4. Policy rules ──────────────────────────────────────────────────
  for (const rule of SEED_RULES) {
    const existing = await db.policyRule.findFirst({
      where: { organizationId: org.id, code: rule.code },
    });

    if (!existing) {
      await db.policyRule.create({
        data: {
          organizationId: org.id,
          code: rule.code,
          title: rule.title,
          body: rule.body,
          keywords: JSON.stringify(rule.keywords),
          patterns: JSON.stringify(rule.patterns),
          severity: rule.severity,
          category: rule.category,
          isManual: true,
          isActive: true,
        },
      });
      console.log(`  ✅ قانون ایجاد شد: ${rule.code} — ${rule.title}`);
    } else {
      console.log(`  ⏭️  قانون از قبل وجود دارد: ${rule.code}`);
    }
  }

  console.log("\n✅ عملیات seed با موفقیت انجام شد.");
}

main()
  .catch((err) => {
    console.error("❌ خطا در اجرای seed:", err);
    process.exit(1);
  })
  .finally(() => {
    void db.$disconnect();
  });
