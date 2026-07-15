export const PRELIM_DELIVERY_NOT_ARMED = 'prelim delivery not armed';

export type PrelimDeliveryMode =
  | { mode: 'test'; armed: true; testRecipient: string; message: string }
  | { mode: 'live'; armed: true; message: string }
  | { mode: 'blocked'; armed: false; message: string };

export function getPrelimDeliveryMode(): PrelimDeliveryMode {
  const testRecipient = process.env.PRELIM_DELIVERY_TEST_RECIPIENT?.trim();
  if (testRecipient) {
    return {
      mode: 'test',
      armed: true,
      testRecipient,
      message: `TEST — will send only to ${testRecipient}`,
    };
  }

  if (process.env.PRELIM_DELIVERY_LIVE === 'true') {
    return {
      mode: 'live',
      armed: true,
      message: 'LIVE — will send to the real recipients below',
    };
  }

  return {
    mode: 'blocked',
    armed: false,
    message: PRELIM_DELIVERY_NOT_ARMED,
  };
}
