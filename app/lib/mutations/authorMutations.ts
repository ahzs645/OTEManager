import { createServerFn } from "@tanstack/react-start";
import type { AuthorType, StudentType } from "../../../shared/model";

// Update author info
export const updateAuthorPaymentInfo = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      authorId: string;
      givenName?: string;
      surname?: string;
      email?: string;
      authorType?: AuthorType;
      studentType?: StudentType | null;
      autoDepositAvailable?: boolean;
      etransferEmail?: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { mutationResult } = await import("../../../server/convex");
    return mutationResult("updateAuthorPaymentInfo", data);
  });
