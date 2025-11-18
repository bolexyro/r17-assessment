// Import libraries
const chai = require('chai');
const sinon = require('sinon');

const { expect } = chai;
const { StatusCode } = require('@app/messages');
const processPaymentInstruction = require('./parse-instruction');

describe('processPaymentInstruction', () => {
  before(() => {
    const clock = sinon.useFakeTimers(new Date('2025-11-17T12:00:00.000Z').getTime());
  });

  after(() => {
    sinon.restore();
  });

  // --- Valid Tests ---

  it('Test Case 1: Should execute a successful DEBIT', async () => {
    const request = {
      accounts: [
        { id: 'N90394', balance: 1000, currency: 'USD' },
        { id: 'N9122', balance: 500, currency: 'USD' },
      ],
      instruction: 'DEBIT 500 USD FROM ACCOUNT N90394 FOR CREDIT TO ACCOUNT N9122',
    };

    const result = await processPaymentInstruction(request);

    expect(result.status).to.equal('successful');
    expect(result.status_code).to.equal(StatusCode.TRANSACTION_SUCCESSFUL);
    expect(result.type).to.equal('DEBIT');
    expect(result.accounts[0].balance).to.equal(500);
    expect(result.accounts[1].balance).to.equal(1000);
  });

  it('Test Case 2: Should schedule a pending CREDIT for the future', async () => {
    const request = {
      accounts: [
        { id: 'acc-001', balance: 1000, currency: 'NGN' },
        { id: 'acc-002', balance: 500, currency: 'NGN' },
      ],
      instruction: 'CREDIT 300 NGN TO ACCOUNT acc-002 FOR DEBIT FROM ACCOUNT acc-001 ON 2026-12-31',
    };

    const result = await processPaymentInstruction(request);

    expect(result.status).to.equal('pending');
    expect(result.status_code).to.equal(StatusCode.TRANSACTION_PENDING);
    expect(result.type).to.equal('CREDIT');
    expect(result.execute_by).to.equal('2026-12-31');
    expect(result.accounts[0].balance).to.equal(1000);
    expect(result.accounts[1].balance).to.equal(500);
  });

  it('Test Case 3: Should handle case insensitive keywords', async () => {
    const request = {
      accounts: [
        { id: 'a', balance: 500, currency: 'GBP' },
        { id: 'b', balance: 200, currency: 'GBP' },
      ],
      instruction: 'debit 100 gbp from account a for credit to account b',
    };

    const result = await processPaymentInstruction(request);

    expect(result.status).to.equal('successful');
    expect(result.currency).to.equal('GBP');
    expect(result.accounts[0].balance).to.equal(400);
    expect(result.accounts[1].balance).to.equal(300);
  });

  it('Test Case 4: Should execute immediately for a past date', async () => {
    const request = {
      accounts: [
        { id: 'x', balance: 500, currency: 'NGN' },
        { id: 'y', balance: 200, currency: 'NGN' },
      ],
      instruction: 'DEBIT 100 NGN FROM ACCOUNT x FOR CREDIT TO ACCOUNT y ON 2024-01-15',
    };

    const result = await processPaymentInstruction(request);

    expect(result.status).to.equal('successful');
    expect(result.execute_by).to.be.null; // Chai's syntax for null
    expect(result.accounts[0].balance).to.equal(400);
  });

  // --- Invalid Tests (using try...catch) ---

  it('Test Case 5 (CU01): Should fail for currency mismatch', async () => {
    const request = {
      accounts: [
        { id: 'a', balance: 100, currency: 'USD' },
        { id: 'b', balance: 500, currency: 'GBP' },
      ],
      instruction: 'DEBIT 50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status).to.equal('failed');
      expect(error.context.status_code).to.equal(StatusCode.CURRENCY_MISMATCH);
      expect(error.context.accounts[0].balance).to.equal(100);
      expect(error.context.accounts[1].balance).to.equal(500);
    }
  });

  it('Test Case 6 (AC01): Should fail for insufficient funds', async () => {
    const request = {
      accounts: [
        { id: 'a', balance: 100, currency: 'USD' },
        { id: 'b', balance: 500, currency: 'USD' },
      ],
      instruction: 'DEBIT 500 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status).to.equal('failed');
      expect(error.context.status_code).to.equal(StatusCode.INSUFFICIENT_FUNDS);
    }
  });

  it('Test Case 7 (CU02): Should fail for unsupported currency', async () => {
    const request = {
      accounts: [
        { id: 'a', balance: 100, currency: 'EUR' },
        { id: 'b', balance: 500, currency: 'EUR' },
      ],
      instruction: 'DEBIT 50 EUR FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status_code).to.equal(StatusCode.UNSUPPORTED_CURRENCY);
    }
  });

  it('Test Case 8 (AC02): Should fail for same account', async () => {
    const request = {
      accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
      instruction: 'DEBIT 100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT a',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status_code).to.equal(StatusCode.SAME_ACCOUNT_ERROR);
    }
  });

  it('Test Case 9 (AM01): Should fail for negative amount', async () => {
    const request = {
      accounts: [
        { id: 'a', balance: 500, currency: 'USD' },
        { id: 'b', balance: 200, currency: 'USD' },
      ],
      instruction: 'DEBIT -100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status_code).to.equal(StatusCode.INVALID_AMOUNT);
      expect(error.context.amount).to.equal(-100);
    }
  });

  it('Test Case 10 (AC03): Should fail for account not found', async () => {
    const request = {
      accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
      instruction: 'DEBIT 100 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT xyz',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status_code).to.equal(StatusCode.ACCOUNT_NOT_FOUND);
      expect(error.context.credit_account).to.equal('xyz');
      expect(error.context.accounts).to.deep.equal([]); // Use deep.equal for arrays/objects
    }
  });

  it('Test Case 11 (AM01): Should fail for decimal amount', async () => {
    const request = {
      accounts: [
        { id: 'a', balance: 500, currency: 'USD' },
        { id: 'b', balance: 200, currency: 'USD' },
      ],
      instruction: 'DEBIT 100.50 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status_code).to.equal(StatusCode.INVALID_AMOUNT);
      expect(error.context.amount).to.equal(100.5);
    }
  });

  it('Test Case 12 (SY01/SY03): Should fail for malformed instruction', async () => {
    const request = {
      accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
      instruction: 'SEND 100 USD TO ACCOUNT b',
    };

    try {
      await processPaymentInstruction(request);
      throw new Error('Test failed: Should have thrown an error.');
    } catch (error) {
      expect(error.context.status_code).to.oneOf([
        StatusCode.MISSING_REQUIRED_KEYWORD,
        StatusCode.MALFORMED_INSTRUCTION,
      ]);
      expect(error.context.type).to.be.null;
      expect(error.context.amount).to.be.null;
      expect(error.context.accounts).to.deep.equal([]);
    }
  });
});
