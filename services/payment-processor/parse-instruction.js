const { throwAppError } = require('@app-core/errors');
const validator = require('@app-core/validator');
const { PaymentMessage, StatusCode } = require('@app/messages');

const spec = `root {
  accounts[] {
    id string<trim|minlength:1>
    balance number<min:0>
    currency string<uppercase>
  }
  instruction string<trim|minlength:1>
}`;

const parsedInstructionSpec = validator.parse(spec);

function Ok(value) {
  return { isOk: true, value };
}

function Err(error) {
  return { isOk: false, error };
}

function isErr(result) {
  return result.isOk === false;
}

/**
 * Formats and throws a standardized application error with a context object.
 * This function does not return; it throws an error.
 * @param {string} errorCode - The payment status code (e.g., 'AC01').
 * @param {string} errorMessage - The human-readable error message.
 * @param {object} instructionData - The parsed instruction data.
 * @param {Array<object>} accounts - The accounts involved (or empty array).
 */
function throwAppErrorWithContext(errorCode, errorMessage, instructionData, accounts) {
  let errorContext;

  if (
    errorCode === StatusCode.MISSING_REQUIRED_KEYWORD ||
    errorCode === StatusCode.MALFORMED_INSTRUCTION
  ) {
    errorContext = {
      type: null,
      amount: null,
      currency: null,
      debit_account: null,
      credit_account: null,
      execute_by: null,
      status: 'failed',
      status_reason: errorMessage,
      status_code: errorCode,
      accounts: [],
    };
  } else {
    errorContext = {
      type: instructionData.transactionType,
      amount: instructionData.amount,
      currency: instructionData.currency,
      debit_account: instructionData.debitAccountId,
      credit_account: instructionData.creditAccountId,
      execute_by: null,
      status: 'failed',
      status_reason: errorMessage,
      status_code: errorCode,
      accounts: accounts.map((account) => ({
        id: account.id,
        balance: account.balance,
        balance_before: account.balance,
        currency: account.currency,
      })),
    };
  }
  throwAppError(errorMessage, errorCode, {
    context: errorContext,
  });
}

/**
 * Finds and validates the presence of debit and credit accounts from the main list in the request.
 * @param {Array<object>} allAccounts - The complete list of accounts from the request.
 * @param {object} instructionData - The parsed instruction data.
 * @returns {{isOk: boolean, value?: Array<object>, error?: object}} Ok with the two accounts, or Err if missing.
 */
function resolveInstructionAccounts(allAccounts, instructionData) {
  const requiredAccountIds = [instructionData.debitAccountId, instructionData.creditAccountId];

  const involvedAccounts = allAccounts.filter((acc) => requiredAccountIds.includes(acc.id));

  const foundIds = involvedAccounts.map((a) => a.id);
  let missingId = null;

  if (!foundIds.includes(instructionData.debitAccountId)) {
    missingId = instructionData.debitAccountId;
  } else if (!foundIds.includes(instructionData.creditAccountId)) {
    missingId = instructionData.creditAccountId;
  }

  if (missingId) {
    return Err({
      code: StatusCode.ACCOUNT_NOT_FOUND,
      message: PaymentMessage.ACCOUNT_NOT_FOUND(missingId),
    });
  }

  return Ok(involvedAccounts);
}

/**
 * Validates the account ID against allowed characters (alphanumeric, -, ., @).
 * @param {string} accountId - The account ID to check.
 * @returns {{isOk: boolean, value?: string, error?: object}} Ok with the ID, or Err.
 */
function validateAccountId(accountId) {
  const allowedSpecialChars = '-.@';
  for (const char of accountId) {
    if (
      !(
        (char >= 'a' && char <= 'z') ||
        (char >= 'A' && char <= 'Z') ||
        (char >= '0' && char <= '9') ||
        allowedSpecialChars.includes(char)
      )
    ) {
      return Err({
        code: StatusCode.INVALID_ACCOUNT_ID,
        message: PaymentMessage.INVALID_ACCOUNT_ID(accountId),
      });
    }
  }
  return Ok(accountId);
}
function validateCurrency(currency) {
  if (!['NGN', 'USD', 'GBP', 'GHS'].includes(currency.toUpperCase())) {
    return Err({
      code: StatusCode.UNSUPPORTED_CURRENCY,
      message: PaymentMessage.UNSUPPORTED_CURRENCY(currency),
    });
  }
  return Ok(currency.toUpperCase());
}
/**
 * Validates that the two involved accounts have valid ids, matching, supported currencies.
 * @param {Array<object>} accounts - The two involved accounts.
 * @returns {{isOk: boolean, value?: Array<object>, error?: object}} Ok with the accounts, or Err.
 */
function validateInvolvedAccounts(accounts) {
  for (const acc of accounts) {
    const idCheck = validateAccountId(acc.id);
    if (isErr(idCheck)) return idCheck;
  }

  const firstAccountCurrency = accounts[0].currency;
  const secondAccountCurrency = accounts[1].currency;

  for (const currency of [firstAccountCurrency, secondAccountCurrency]) {
    const currencyCheck = validateCurrency(currency);
    if (isErr(currencyCheck)) return currencyCheck;
  }

  if (firstAccountCurrency !== secondAccountCurrency) {
    return Err({
      code: StatusCode.CURRENCY_MISMATCH,
      message: PaymentMessage.CURRENCY_MISMATCH,
    });
  }
  return Ok(accounts);
}

/**
 * Normalizes all whitespace characters in an instruction string and splits it by spaces.
 * @param {string} instruction - The raw instruction string.
 * @returns {Array<string>} An array of instruction parts.
 */
function getPaymentInstructionParts(instruction) {
  // https://stackoverflow.com/questions/18169006/all-the-whitespace-characters-is-it-language-independent
  const whitespaceCharacters = [
    // Zs category
    '\u0020',
    '\u00A0',
    '\u1680',
    '\u2000',
    '\u2001',
    '\u2002',
    '\u2003',
    '\u2004',
    '\u2005',
    '\u2006',
    '\u2007',
    '\u2008',
    '\u2009',
    '\u200A',
    '\u202F',
    '\u205F',
    '\u3000',
    // Cc category
    '\u0009',
    '\u000A',
    '\u000B',
    '\u000C',
    '\u000D',
    // Language-specific
    '\u1361',
  ];

  let normalized = instruction;
  for (const w of whitespaceCharacters) {
    normalized = normalized.replaceAll(w, ' ');
  }
  const parts = normalized.split(' ').filter(Boolean);
  return parts;
}

/**
 * Parses the instruction parts array into a structured data object.
 * Validates keyword order and presence for DEBIT and CREDIT formats.
 * @param {Array<string>} parts - The parts from getPaymentInstructionParts.
 * @returns {{isOk: boolean, value?: object, error?: object}} Ok with structured data, or Err.
 */
function parseInstructionParts(parts) {
  if (parts.length < 11 || parts.length > 13) {
    return Err({
      code: StatusCode.MALFORMED_INSTRUCTION,
      message: PaymentMessage.MALFORMED_INSTRUCTION,
    });
  }

  const transactionTypeKeywordPosition = 0;
  const transactionTypeKeyword = parts[transactionTypeKeywordPosition].toUpperCase();

  if (!['DEBIT', 'CREDIT'].includes(transactionTypeKeyword)) {
    return Err({
      code: StatusCode.MISSING_REQUIRED_KEYWORD,
      message: PaymentMessage.MISSING_REQUIRED_KEYWORD('DEBIT or CREDIT'),
    });
  }

  const amount = Number(parts[transactionTypeKeywordPosition + 1]);

  const currencyKeywordPosition = transactionTypeKeywordPosition + 2;
  const currency = parts[currencyKeywordPosition].toUpperCase();

  let debitAccountId;
  let creditAccountId;
  let date;

  if (transactionTypeKeyword === 'DEBIT') {
    const fromKeywordPosition = currencyKeywordPosition + 1;
    let expectedNextPhrase = 'FROM ACCOUNT';
    let nextPhrase = parts
      .slice(fromKeywordPosition, fromKeywordPosition + 2)
      .join(' ')
      .toUpperCase();

    if (nextPhrase !== expectedNextPhrase) {
      return Err({
        code: StatusCode.MISSING_REQUIRED_KEYWORD,
        message: PaymentMessage.MISSING_REQUIRED_KEYWORD('FROM ACCOUNT'),
      });
    }

    const debitAccountIdKeywordPosition = fromKeywordPosition + 2;
    debitAccountId = parts[debitAccountIdKeywordPosition];
    expectedNextPhrase = 'FOR CREDIT TO ACCOUNT';

    nextPhrase = parts
      .slice(debitAccountIdKeywordPosition + 1, debitAccountIdKeywordPosition + 5)
      .join(' ')
      .toUpperCase();

    if (nextPhrase !== expectedNextPhrase) {
      return Err({
        code: StatusCode.MISSING_REQUIRED_KEYWORD,
        message: PaymentMessage.MISSING_REQUIRED_KEYWORD('FOR CREDIT TO ACCOUNT'),
      });
    }
    creditAccountId = parts[debitAccountIdKeywordPosition + 5];
  } else {
    const toKeywordPosition = currencyKeywordPosition + 1;
    let expectedNextPhrase = 'TO ACCOUNT';
    let nextPhrase = parts
      .slice(toKeywordPosition, toKeywordPosition + 2)
      .join(' ')
      .toUpperCase();
    if (nextPhrase !== expectedNextPhrase) {
      return Err({
        code: StatusCode.MISSING_REQUIRED_KEYWORD,
        message: PaymentMessage.MISSING_REQUIRED_KEYWORD('TO ACCOUNT'),
      });
    }

    const creditAccountIdKeywordPosition = toKeywordPosition + 2;
    creditAccountId = parts[creditAccountIdKeywordPosition];
    expectedNextPhrase = 'FOR DEBIT FROM ACCOUNT';

    nextPhrase = parts
      .slice(creditAccountIdKeywordPosition + 1, creditAccountIdKeywordPosition + 5)
      .join(' ')
      .toUpperCase();
    if (nextPhrase !== expectedNextPhrase) {
      return Err({
        code: StatusCode.MISSING_REQUIRED_KEYWORD,
        message: PaymentMessage.MISSING_REQUIRED_KEYWORD('FOR DEBIT FROM ACCOUNT'),
      });
    }
    debitAccountId = parts[creditAccountIdKeywordPosition + 5];
  }
  if (parts.length > 11) {
    const dateKeywordPosition = parts.length - 1;
    date = parts[dateKeywordPosition];

    if (parts[dateKeywordPosition - 1] !== 'ON') {
      return Err({
        code: StatusCode.MISSING_REQUIRED_KEYWORD,
        message: PaymentMessage.MISSING_REQUIRED_KEYWORD('ON'),
      });
    }
  }
  return Ok({
    transactionType: transactionTypeKeyword,
    amount,
    currency,
    debitAccountId,
    creditAccountId,
    date,
  });
}

/**
 * Validates a YYYY-MM-DD date string.
 * @param {string} dateString - The date string to validate.
 * @returns {{isOk: boolean, value?: Date, error?: object}} Ok with a UTC Date object, or Err.
 */
function validateDate(dateString) {
  const invalidDateFormatError = Err({
    code: StatusCode.INVALID_DATE_FORMAT,
    message: PaymentMessage.INVALID_DATE_FORMAT(dateString),
  });
  if (dateString.length !== 10) {
    return invalidDateFormatError;
  }
  if (dateString[4] !== '-' || dateString[7] !== '-') {
    return invalidDateFormatError;
  }
  const [year, month, day] = dateString.split('-').map(Number);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return invalidDateFormatError;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return invalidDateFormatError;
  }

  const daysInMonth = new Date(year, month, 0).getDate();

  if (day > daysInMonth) {
    return invalidDateFormatError;
  }
  return Ok(new Date(Date.UTC(year, month - 1, day)));
}
/**
 * Checks if a currency is in the supported list (NGN, USD, GBP, GHS).
 * @param {string} currency - The currency code.
 * @returns {{isOk: boolean, value?: string, error?: object}} Ok with the uppercase currency, or Err.
 */

/**
 * Validates the semantic data from the parsed instruction (amount, same account).
 * @param {object} instructionData - The data from parseInstructionParts.
 * @returns {{isOk: boolean, value?: object, error?: object}} Ok with validated/typed data, or Err.
 */
function validateInstructionData(instructionData) {
  const { debitAccountId, creditAccountId, amount, currency } = instructionData;
  let { date } = instructionData;

  const debitAccountCheck = validateAccountId(debitAccountId);
  if (isErr(debitAccountCheck)) return debitAccountCheck;
  const creditAccountCheck = validateAccountId(creditAccountId);
  if (isErr(creditAccountCheck)) return creditAccountCheck;

  if (creditAccountId === debitAccountId) {
    return Err({ code: StatusCode.SAME_ACCOUNT_ERROR, message: PaymentMessage.SAME_ACCOUNT_ERROR });
  }

  if (!Number.isInteger(amount) || amount <= 0) {
    return Err({
      code: StatusCode.INVALID_AMOUNT,
      message: PaymentMessage.INVALID_AMOUNT(amount),
    });
  }

  const currencyCheck = validateCurrency(currency);
  if (isErr(currencyCheck)) return currencyCheck;

  if (date) {
    const dateCheck = validateDate(date);
    if (isErr(dateCheck)) return dateCheck;
    date = dateCheck.value;
  }
  return Ok({
    transactionType: instructionData.transactionType,
    debitAccountId,
    creditAccountId,
    amount,
    currency,
    date: date ?? null,
  });
}

/**
 * Checks if a UTC date is after the current UTC date.
 * @param {Date} date - The UTC date object to check.
 * @returns {boolean} True if the date is in the future.
 */
function isAfterToday(date) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return date > today;
}

/**
 * Executes the transaction logic (or marks as pending) on the two accounts.
 * @param {object} instructionParts - The validated instruction data.
 * @param {Array<object>} accounts - The two *involved* accounts.
 * @returns {Promise<{isOk: boolean, value?: object, error?: object}>} Ok with the final transaction response, or Err.
 */
async function executeInstruction(instructionParts, accounts) {
  if (instructionParts.currency !== accounts[0].currency) {
    return Err({
      code: StatusCode.CURRENCY_MISMATCH,
      message: PaymentMessage.INSTRUCTION_CURRENCY_MISMATCH(
        accounts[0].currency,
        instructionParts.currency
      ),
    });
  }

  const debitAccount = accounts.find((account) => account.id === instructionParts.debitAccountId);
  const creditAccount = accounts.find((account) => account.id === instructionParts.creditAccountId);

  if (debitAccount.balance < instructionParts.amount) {
    return Err({
      code: StatusCode.INSUFFICIENT_FUNDS,
      message: PaymentMessage.INSUFFICIENT_FUNDS(debitAccount.id),
    });
  }

  const shouldExecuteNow = !instructionParts.date || !isAfterToday(instructionParts.date);

  const finalBalances = {
    [debitAccount.id]: shouldExecuteNow
      ? debitAccount.balance - instructionParts.amount
      : debitAccount.balance,
    [creditAccount.id]: shouldExecuteNow
      ? creditAccount.balance + instructionParts.amount
      : creditAccount.balance,
  };

  const finalAccountsResponse = accounts.map((acc) => ({
    id: acc.id,
    balance: finalBalances[acc.id],
    balance_before: acc.balance,
    currency: acc.currency.toUpperCase(),
  }));

  return Ok({
    type: instructionParts.transactionType,
    amount: instructionParts.amount,
    currency: instructionParts.currency,
    debit_account: debitAccount.id,
    credit_account: creditAccount.id,
    execute_by: shouldExecuteNow ? null : instructionParts.date.toISOString().split('T')[0],
    status: shouldExecuteNow ? 'successful' : 'pending',
    status_code: shouldExecuteNow
      ? StatusCode.TRANSACTION_SUCCESSFUL
      : StatusCode.TRANSACTION_PENDING,
    accounts: finalAccountsResponse,
  });
}

async function processPaymentInstruction(paymentData) {
  const data = validator.validate(paymentData, parsedInstructionSpec);

  const instructionParts = getPaymentInstructionParts(data.instruction);

  const instructionDataResult = parseInstructionParts(instructionParts);

  if (isErr(instructionDataResult)) {
    throwAppErrorWithContext(instructionDataResult.error.code, instructionDataResult.error.message);
  }

  const instructionData = instructionDataResult.value;

  const involvedAccountsResult = resolveInstructionAccounts(data.accounts, instructionData);

  if (isErr(involvedAccountsResult)) {
    throwAppErrorWithContext(
      involvedAccountsResult.error.code,
      involvedAccountsResult.error.message,
      instructionData,
      []
    );
  }

  const involvedAccounts = involvedAccountsResult.value;

  const validateInstructionDataCheck = validateInstructionData(instructionDataResult.value);

  if (isErr(validateInstructionDataCheck)) {
    throwAppErrorWithContext(
      validateInstructionDataCheck.error.code,
      validateInstructionDataCheck.error.message,
      instructionData,
      involvedAccounts
    );
  }
  const validatedInstructionData = validateInstructionDataCheck.value;

  const involvedAccountsCheck = validateInvolvedAccounts(involvedAccounts);
  if (isErr(involvedAccountsCheck)) {
    throwAppErrorWithContext(
      involvedAccountsCheck.error.code,
      involvedAccountsCheck.error.message,
      instructionData,
      involvedAccounts
    );
  }

  const executionResult = await executeInstruction(validatedInstructionData, involvedAccounts);
  if (isErr(executionResult)) {
    throwAppErrorWithContext(
      executionResult.error.code,
      executionResult.error.message,
      validatedInstructionData,
      involvedAccounts
    );
  }
  return executionResult.value;
}

module.exports = processPaymentInstruction;
