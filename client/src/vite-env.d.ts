/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RAZORPAY_PAYMENT_LINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
