import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { encryptField } from "@/lib/crypto";
import {
  completedEmail,
  signingRequestEmail,
  worksheetInviteEmail,
  worksheetSubmittedEmail,
} from "@/lib/email";
import { maskSensitiveValues } from "@/lib/fields/sensitive";
import { FieldDefinition } from "@/lib/fields/types";
import { isRateLimited } from "@/lib/rate-limit";

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
});

const sensitiveDefs = [
  { key: "owner.ssn", sensitive: true },
  { key: "bank.account_number", sensitive: true },
] as FieldDefinition[];

describe("sensitive data never leaves the server (build plan §9)", () => {
  it("masked payloads contain no ciphertext and no plaintext", () => {
    const stored = {
      "owner.ssn": encryptField("123-45-6789"),
      "bank.account_number": encryptField("000123456"),
      "business.dba": "Acme Mart",
    };
    const masked = JSON.stringify(maskSensitiveValues(sensitiveDefs, stored));
    expect(masked).not.toContain("enc:v1:");
    expect(masked).not.toContain("123-45-6789");
    expect(masked).not.toContain("000123456");
  });

  it("email templates never reference sensitive dictionary keys", () => {
    // Static audit: no email code path can interpolate SSN / account numbers.
    const emailSource = readFileSync(
      path.resolve(__dirname, "../src/lib/email/index.ts"),
      "utf8"
    );
    expect(emailSource).not.toContain("owner.ssn");
    expect(emailSource).not.toContain("bank.account_number");
  });

  it("rendered emails contain only the fields they are given", () => {
    const outputs = [
      worksheetInviteEmail({ businessName: "Acme", link: "https://x", expiresDays: 30 }),
      worksheetSubmittedEmail({ businessName: "Acme", adminLink: "https://x" }),
      signingRequestEmail({
        signerName: "Jordan",
        businessName: "Acme",
        documentName: "App",
        link: "https://x",
        expiresDays: 14,
      }),
      completedEmail({ recipientName: "Jordan", businessName: "Acme", documentName: "App" }),
    ];
    for (const o of outputs) {
      expect(o.html).not.toContain("enc:v1:");
      expect(o.html).not.toMatch(/\d{3}-\d{2}-\d{4}/);
    }
  });

  it("audit logging call sites never put dictionary values in meta", () => {
    // Static audit over all server code: logAuditEvent meta objects must not
    // reference data[...] lookups (only static labels / derived counts).
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry)) {
          const src = readFileSync(p, "utf8");
          for (const m of src.matchAll(/logAuditEvent\(\{[\s\S]*?\}\)/g)) {
            if (/meta:\s*\{[^}]*data\[/.test(m[0])) offenders.push(p);
          }
        }
      }
    };
    walk(path.resolve(__dirname, "../src"));
    expect(offenders).toEqual([]);
  });
});

describe("rate limiting on public token routes", () => {
  function req(ip: string): Request {
    return new Request("https://x.test/api", {
      headers: { "x-forwarded-for": ip },
    });
  }

  it("allows up to the limit, then rejects", () => {
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(req("10.0.0.1"), "test_bucket", 5)).toBe(false);
    }
    expect(isRateLimited(req("10.0.0.1"), "test_bucket", 5)).toBe(true);
  });

  it("separates buckets and IPs", () => {
    for (let i = 0; i < 5; i++) isRateLimited(req("10.0.0.2"), "bucket_a", 5);
    expect(isRateLimited(req("10.0.0.2"), "bucket_a", 5)).toBe(true);
    expect(isRateLimited(req("10.0.0.2"), "bucket_b", 5)).toBe(false);
    expect(isRateLimited(req("10.0.0.3"), "bucket_a", 5)).toBe(false);
  });

  it("fails closed when flooded with distinct keys (bounded memory)", () => {
    // Fill well past the 10k entry cap with unique IPs in one window; new
    // keys must be refused rather than growing the map without bound.
    for (let i = 0; i < 10_100; i++) {
      isRateLimited(req(`10.1.${Math.floor(i / 250)}.${i % 250}`), "flood", 5);
    }
    expect(isRateLimited(req("172.16.0.1"), "flood", 5)).toBe(true);
  });

  it("every public token route enforces a limit", () => {
    const routeDirs = [
      "../src/app/api/w/[token]",
      "../src/app/api/sign/[token]",
    ];
    for (const dir of routeDirs) {
      const base = path.resolve(__dirname, dir);
      for (const sub of readdirSync(base)) {
        const routeFile = path.join(base, sub, "route.ts");
        const src = readFileSync(routeFile, "utf8");
        expect(src, `${sub} route must rate-limit`).toContain("isRateLimited(");
      }
    }
  });
});

describe("storage stays private", () => {
  it("no code path uses public storage URLs", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = path.join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry)) {
          if (readFileSync(p, "utf8").includes("getPublicUrl")) offenders.push(p);
        }
      }
    };
    walk(path.resolve(__dirname, "../src"));
    expect(offenders).toEqual([]);
  });
});
