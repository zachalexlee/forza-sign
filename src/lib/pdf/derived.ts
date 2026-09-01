import { decryptField, isEncrypted } from "@/lib/crypto";
import { WorksheetData } from "@/lib/fields/types";
import { isAlreadyOpen } from "@/lib/fields/validators";
import { FillContext } from "./types";

/**
 * Derived rules from Appendix C — data, not code branches in templates.
 * Each rule resolves to a string (fields) or boolean (checkboxes).
 */

function str(data: WorksheetData, key: string): string {
  const v = data[key];
  if (v === undefined || v === null) return "";
  if (typeof v === "string" && isEncrypted(v)) return decryptField(v);
  return String(v);
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Every rule the engine knows — the mapper UI's dropdown source. */
export const DERIVED_RULE_NAMES = [
  "send_day",
  "send_month",
  "send_year",
  "send_date_us",
  "already_open",
  "opening_soon",
  "shipping_if_different",
  "manager_name_title",
  "cash_loader_name",
  "w9_tin_ssn",
  "w9_tin_ein",
  "w9_class_individual",
  "w9_class_c_corp",
  "w9_class_partnership",
  "w9_class_llc",
  "w9_llc_tax_code",
  "wireless_selected",
  "wireless_fee",
  "business_city_state_zip",
  "bank_city_state_zip",
] as const;

export function resolveDerived(rule: string, ctx: FillContext): string | boolean {
  const { data, sendDate, programCode } = ctx;

  switch (rule) {
    // Agreement date stamps (pp. 3, 7): date of sending.
    case "send_day":
      return String(sendDate.getDate());
    case "send_month":
      return sendDate.toLocaleString("en-US", { month: "long" });
    case "send_year":
      return String(sendDate.getFullYear());
    case "send_date_us":
      return `${String(sendDate.getMonth() + 1).padStart(2, "0")}/${String(
        sendDate.getDate()
      ).padStart(2, "0")}/${sendDate.getFullYear()}`;

    // business.open_date <= send date → "Already Open" / "New Account".
    case "already_open": {
      const openDate = str(data, "business.open_date");
      return openDate ? isAlreadyOpen(openDate, sendDate) : false;
    }
    case "opening_soon": {
      const openDate = str(data, "business.open_date");
      return openDate ? !isAlreadyOpen(openDate, sendDate) : false;
    }

    // Shipping address prints only if different from the business address.
    case "shipping_if_different": {
      if (data["install.shipping_same_as_business"] === true) return "";
      return str(data, "install.shipping_address");
    }

    // Cover sheet "Manager" = store contact, name + title combined.
    case "manager_name_title": {
      const name = str(data, "contact.name");
      const title = str(data, "contact.job_title");
      return [name, title].filter(Boolean).join(", ");
    }

    // Cash Loader Name: constant for cash-loading variants, merchant's own
    // loader for merchant-load.
    case "cash_loader_name":
      return programCode === "mo-ml"
        ? str(data, "install.cash_loader_name")
        : "Forza Cash Loader";

    // W-9 TIN (Part I): Sole Prop → SSN digits, otherwise EIN digits.
    case "w9_tin_ssn":
      return data["business.classification"] === "sole_prop"
        ? digitsOf(str(data, "owner.ssn"))
        : "";
    case "w9_tin_ein":
      return data["business.classification"] !== "sole_prop"
        ? digitsOf(str(data, "business.ein"))
        : "";

    // W-9 box 3a from business.classification.
    case "w9_class_individual":
      return data["business.classification"] === "sole_prop";
    case "w9_class_c_corp":
      return data["business.classification"] === "corporation";
    case "w9_class_partnership":
      return data["business.classification"] === "partnership";
    case "w9_class_llc":
      return (
        data["business.classification"] === "llc_s" ||
        data["business.classification"] === "llc_c"
      );
    case "w9_llc_tax_code":
      return data["business.classification"] === "llc_s"
        ? "S"
        : data["business.classification"] === "llc_c"
          ? "C"
          : "";

    // Wireless box → $25.95/mo fee lines.
    case "wireless_selected":
      return data["install.wireless_box"] === true;
    case "wireless_fee":
      return data["install.wireless_box"] === true ? "25.95" : "";

    // Combined address lines used on several pages.
    case "business_city_state_zip":
      return [
        str(data, "location.city"),
        str(data, "location.state"),
        str(data, "location.zip"),
      ]
        .filter(Boolean)
        .join(", ");

    // W-9 address must match the BANK account address (#35–38), never the
    // business location (office manager's rule, Appendix C).
    case "bank_city_state_zip":
      return [str(data, "bank.city"), str(data, "bank.state"), str(data, "bank.zip")]
        .filter(Boolean)
        .join(", ");

    default:
      throw new Error(`Unknown derived rule: ${rule}`);
  }
}
