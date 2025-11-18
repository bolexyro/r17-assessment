const { expect } = require('chai');
const { StatusCode } = require('@app/messages');
const handlerConfig = require('./process');

describe('Payment Instruction Handler', () => {
  const mockHelpers = {
    http_statuses: {
      HTTP_200_OK: 200,
      HTTP_400_BAD_REQUEST: 400,
      HTTP_500_INTERNAL_SERVER_ERROR: 500,
    },
  }; // --- Test Cases ---

  it('should return a 200 status and success data for a valid request', async () => {
    const mockRc = {
      body: {
        accounts: [
          { id: 'N90394', balance: 1000, currency: 'USD' },
          { id: 'N9122', balance: 500, currency: 'USD' },
        ],
        instruction: 'DEBIT 500 USD FROM ACCOUNT N90394 FOR CREDIT TO ACCOUNT N9122',
      },
    };

    const result = await handlerConfig.handler(mockRc, mockHelpers);

    expect(result.status).to.equal(200);
    expect(result.data.status).to.equal('successful');
    expect(result.data.status_code).to.equal(StatusCode.TRANSACTION_SUCCESSFUL);
    expect(result.data.accounts[0].balance).to.equal(500);
  });

  // --- Tests for failures ---

  it('should THROW an error for an invalid request (Insufficient Funds)', async () => {
    const mockRc = {
      body: {
        accounts: [
          { id: 'a', balance: 100, currency: 'USD' },
          { id: 'b', balance: 500, currency: 'USD' },
        ],
        instruction: 'DEBIT 500 USD FROM ACCOUNT a FOR CREDIT TO ACCOUNT b',
      },
    };

    try {
      await handlerConfig.handler(mockRc, mockHelpers);
      throw new Error('Test failed: Handler did not throw an error.');
    } catch (error) {
      expect(error.context).to.exist;
      expect(error.context.status).to.equal('failed');
      expect(error.context.status_code).to.equal(StatusCode.INSUFFICIENT_FUNDS);
      expect(error.context.accounts[0].balance).to.equal(100);
    }
  });

  it('should THROW an error for a malformed instruction', async () => {
    const mockRc = {
      body: {
        accounts: [{ id: 'a', balance: 500, currency: 'USD' }],
        instruction: 'SEND 100 USD TO ACCOUNT b',
      },
    };

    try {
      await handlerConfig.handler(mockRc, mockHelpers);
      throw new Error('Test failed: Handler did not throw an error.');
    } catch (error) {
      expect(error.context).to.exist;
      expect(error.context.status_code).to.oneOf([
        StatusCode.MISSING_REQUIRED_KEYWORD,
        StatusCode.MALFORMED_INSTRUCTION,
      ]);
      expect(error.context.type).to.be.null;
      expect(error.context.accounts).to.deep.equal([]);
    }
  });
});
