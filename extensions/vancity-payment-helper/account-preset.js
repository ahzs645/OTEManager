export function validateSourceAccount(account) {
  if (
    !account ||
    typeof account.accountNumber !== "string" ||
    !/^\d{8,20}$/.test(account.accountNumber) ||
    typeof account.name !== "string" ||
    !account.name.trim() ||
    account.name.length > 120 ||
    typeof account.type !== "string" ||
    account.type.length > 60
  )
    throw new Error("Read and choose a valid source account from Vancity.");
  return {
    accountNumber: account.accountNumber,
    name: account.name.trim(),
    type: account.type.trim(),
  };
}
