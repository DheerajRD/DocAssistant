export const productName = process.env.NEXT_PUBLIC_PRODUCT_NAME || 'DocAssist';
export const legalDisclaimer = "I can help you organize information in your documents, but I can't determine immigration eligibility or provide legal advice. Please confirm this with your DSO or a qualified immigration attorney.";
export const travelDisclaimer = 'This tool checks whether common documents are present in your account and displays recorded dates only. It does not determine whether you are legally permitted to travel or re-enter the United States. Confirm your situation with your DSO or a qualified immigration attorney.';
export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration required: ${name}`);
  return value;
}
export function appUrl() { return new URL(env('APP_URL')).origin; }
