const { createHandler } = require('@app-core/server');
const parsePaymentInstruction = require('@app/services/payment-processor/parse-instruction');

module.exports = createHandler({
  path: '/payment-instructions',
  method: 'post',
  middlewares: [],
  props: {},
  async handler(rc, helpers) {
    const payload = rc.body;

    const response = await parsePaymentInstruction(payload);
    return {
      status: helpers.http_statuses.HTTP_200_OK,
      data: response,
    };
  },
});
