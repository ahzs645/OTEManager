export interface BankReceipt {
  bank: "Vancity";
  status: "sent";
  currency: "CAD";
  reference: string;
  recipientEmail: string;
  recipientName: string;
  amountCents: number;
  feeCents: number;
  message: string;
  transferDate: string;
  receiptDate: string;
  sourceAccountLastFour: string;
}
export interface PaymentConfirmation {
  batchId: string;
  exportedAt: string;
  expectedMessage: string;
  payment: {
    id: string;
    authorId: string;
    recipientEmail: string;
    amountCents: number;
    articles: {
      id: string;
      title: string;
      issue: string;
      amountCents: number;
    }[];
  };
  receipt: BankReceipt;
}
export function receiptText(value: string): string;
export function validateConfirmation(input: unknown): PaymentConfirmation;
