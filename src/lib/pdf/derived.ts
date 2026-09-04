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
  "atm_amount",
  "business_city_state_zip",
  "bank_city_state_zip",
  "owner_home_city_state_zip",
  "owner_first_name",
  "owner_last_name",
  "business_type_label",
  "business_type_other_label",
  "tin_is_ein",
  "tin_is_ssn",
  "wireless_yes_no",
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
      // The agreement blanks are pre-printed "20____" — fill two digits only.
      return String(sendDate.getFullYear() % 100).padStart(2, "0");
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

    // Purchase order line total: # of ATMs × office-set unit price.
    case "atm_amount": {
      const count = Number(str(data, "atm.count"));
      const price = Number(str(data, "atm.price"));
      if (!Number.isFinite(count) || !Number.isFinite(price) || count <= 0 || price <= 0)
        return "";
      return (count * price).toFixed(2);
    }

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

    case "owner_home_city_state_zip":
      return [
        str(data, "owner.home_city"),
        str(data, "owner.home_state"),
        str(data, "owner.home_zip"),
      ]
        .filter(Boolean)
        .join(", ");

    // Source-of-funds form (ML packet) wants the owner name split.
    case "owner_first_name": {
      const parts = str(data, "owner.legal_name").trim().split(/\s+/);
      return parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] ?? "";
    }
    case "owner_last_name": {
      const parts = str(data, "owner.legal_name").trim().split(/\s+/);
      return parts.length > 1 ? parts[parts.length - 1] : "";
    }

    // Human-readable classification for "Business Type ____" lines.
    case "business_type_label":
      return (
        {
          llc_s: "LLC - S Corp",
          llc_c: "LLC - C Corp",
          corporation: "Corporation",
          partnership: "Partnership",
          sole_prop: "Sole Proprietor",
        }[str(data, "business.classification")] ?? ""
      );
    // The application's business-type row has no LLC checkbox — LLCs check
    // "Other" and this label goes on the Other line.
    case "business_type_other_label":
      return data["business.classification"] === "llc_s"
        ? "LLC - S Corp"
        : data["business.classification"] === "llc_c"
          ? "LLC - C Corp"
          : "";

    // TIN type checkboxes (source-of-funds form).
    case "tin_is_ssn":
      return data["business.classification"] === "sole_prop";
    case "tin_is_ein":
      return (
        !!data["business.classification"] &&
        data["business.classification"] !== "sole_prop"
      );

    // The cover sheet's wireless question is a written answer, not a checkbox.
    case "wireless_yes_no":
      return data["install.wireless_box"] === true
        ? "Yes"
        : data["install.wireless_box"] === false
          ? "No"
          : "";

    default:
      throw new Error(`Unknown derived rule: ${rule}`);
  }
}
