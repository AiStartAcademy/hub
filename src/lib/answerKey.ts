export interface OptionWithAnswerKey {
  isCorrect: boolean;
}

interface ItemWithAnswerKey {
  options: readonly OptionWithAnswerKey[];
}

interface PayloadWithAnswerKey {
  items: readonly ItemWithAnswerKey[];
}

type StripItemAnswerKey<TItem extends ItemWithAnswerKey> = Omit<
  TItem,
  "options"
> & {
  options: Array<Omit<TItem["options"][number], "isCorrect">>;
};

export type AnswerKeyStripped<TPayload extends PayloadWithAnswerKey> = Omit<
  TPayload,
  "items"
> & {
  items: Array<StripItemAnswerKey<TPayload["items"][number]>>;
};

export function stripOptionAnswerKey<TOption extends OptionWithAnswerKey>(
  option: TOption
): Omit<TOption, "isCorrect"> {
  const safeOption: Omit<TOption, "isCorrect"> & { isCorrect?: boolean } = {
    ...option,
  };
  delete safeOption.isCorrect;
  return safeOption;
}

export function stripQuizAnswerKey(payload: null): null;
export function stripQuizAnswerKey<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload
): AnswerKeyStripped<TPayload>;
export function stripQuizAnswerKey<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload | null
): AnswerKeyStripped<TPayload> | null;
export function stripQuizAnswerKey<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload | null
): AnswerKeyStripped<TPayload> | null {
  if (payload === null) return null;

  const strippedPayload = {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      options: item.options.map(stripOptionAnswerKey),
    })),
  };

  return strippedPayload as unknown as AnswerKeyStripped<TPayload>;
}

export function answerKeyForViewer<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload,
  viewer: { canManage: true }
): TPayload;
export function answerKeyForViewer<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload,
  viewer: { canManage: false }
): AnswerKeyStripped<TPayload>;
export function answerKeyForViewer<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload,
  viewer: { canManage: boolean }
): TPayload | AnswerKeyStripped<TPayload>;
export function answerKeyForViewer<TPayload extends PayloadWithAnswerKey>(
  payload: TPayload,
  viewer: { canManage: boolean }
): TPayload | AnswerKeyStripped<TPayload> {
  return viewer.canManage ? payload : stripQuizAnswerKey(payload);
}
