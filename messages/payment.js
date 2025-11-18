const PaymentMessage = {
  INVALID_AMOUNT: (amount) => `The amount ${amount} is not a valid positive number.`,
  CURRENCY_MISMATCH: 'Both accounts must have the same currency.',
  INSTRUCTION_CURRENCY_MISMATCH: (accountCurrency, instructionCurrency) =>
    `Account currency ${accountCurrency} does not match instruction currency ${instructionCurrency}.`,
  UNSUPPORTED_CURRENCY: (currency) =>
    `The currency ${currency} is not supported. Only NGN, USD, GBP, GHS are supported.`,
  INSUFFICIENT_FUNDS: (accountId) => `Insufficient funds in debit account - ${accountId}.`,
  SAME_ACCOUNT_ERROR: 'Debit and credit accounts cannot be the same',
  ACCOUNT_NOT_FOUND: (id) =>
    `Account ID: ${id} specified in instruction is not in the provided accounts list`,
  INVALID_ACCOUNT_ID: (accountId) => `Account ID ${accountId} contains invalid characters.`,
  INVALID_DATE_FORMAT: (date) => `The date ${date} is not in a valid YYYY-MM-DD format.`,
  MISSING_REQUIRED_KEYWORD: (keyword) =>
    `The required keyword ${keyword} is missing from the instruction.`,
  MALFORMED_INSTRUCTION: 'The payment instruction is malformed.',
  TRANSACTION_SUCCESSFUL: 'Transaction executed successfully',
  TRANSACTION_PENDING: 'Transaction scheduled for future execution',
};

const StatusCode = {
  INVALID_AMOUNT: 'AM01',
  CURRENCY_MISMATCH: 'CU01',
  UNSUPPORTED_CURRENCY: 'CU02',
  INSUFFICIENT_FUNDS: 'AC01',
  SAME_ACCOUNT_ERROR: 'AC02',
  ACCOUNT_NOT_FOUND: 'AC03',
  INVALID_ACCOUNT_ID: 'AC04',
  INVALID_DATE_FORMAT: 'DT01',
  MISSING_REQUIRED_KEYWORD: 'SY01',
  MALFORMED_INSTRUCTION: 'SY03',
  TRANSACTION_SUCCESSFUL: 'AP00',
  TRANSACTION_PENDING: 'AP02',
};

module.exports = {
  PaymentMessage,
  StatusCode,
};
