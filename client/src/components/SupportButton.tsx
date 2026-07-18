// Reads the Razorpay Payment Link from a build-time env var so the button
// can be wired up without touching code — set VITE_RAZORPAY_PAYMENT_LINK
// in client/.env (local) or in your host's dashboard (production).
const PAYMENT_LINK = import.meta.env.VITE_RAZORPAY_PAYMENT_LINK as string | undefined;

export function SupportButton() {
  if (!PAYMENT_LINK) return null;

  return (
    <a
      className="support-btn"
      href={PAYMENT_LINK}
      target="_blank"
      rel="noopener noreferrer"
    >
      Support this website
    </a>
  );
}
