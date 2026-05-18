import OpenAI from "openai";
import { config } from "./config.js";
import {
  sendAgentPhoneMessage,
  type PostCallWebhook,
  type SendAgentPhoneMessageOptions
} from "./agentphone.js";
import { callReservationId, recordReservationCall } from "./reservation-store.js";

export type ReservationDetails = {
  guestName?: string;
  partySize?: string;
  day?: string;
  time?: string;
  specialNotes?: string;
};

export type ReservationLogEntry = {
  id: string;
  callId?: string;
  caller: string;
  createdAt: string;
  conversationContext?: string;
  reservation: ReservationDetails;
  deposit?: ReservationDeposit;
};

export function createReservationLogEntry(input: {
  callId?: string;
  caller: string;
  conversationContext?: string;
  reservation: ReservationDetails;
  deposit?: ReservationDeposit;
  createdAt?: string;
}): ReservationLogEntry {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: callReservationId(input.callId, input.caller, createdAt),
    callId: input.callId,
    caller: input.caller,
    createdAt,
    conversationContext: input.conversationContext,
    reservation: input.reservation,
    deposit: input.deposit
  };
}

async function defaultReservationRecorder(entry: ReservationLogEntry): Promise<void> {
  recordReservationCall({
    id: entry.id,
    callId: entry.callId,
    caller: entry.caller,
    conversationContext: entry.conversationContext,
    reservation: entry.reservation,
    deposit: entry.deposit
      ? {
          amountCents: entry.deposit.amountCents,
          currency: entry.deposit.currency,
          paymentLinkUrl: entry.deposit.paymentLinkUrl
        }
      : undefined,
    createdAt: entry.createdAt
  });
}

export type PostCallSummary = {
  shouldSend: boolean;
  conversationContext: string;
  reservation: ReservationDetails;
};

export type PostCallResult = {
  sent: boolean;
  reason?: string;
  message?: string;
  summary?: PostCallSummary;
};

export type PostCallMessageSender = (options: Omit<SendAgentPhoneMessageOptions, "apiKey" | "agentId" | "baseUrl">) => Promise<unknown>;
export type PostCallExtractor = (call: PostCallWebhook) => Promise<PostCallSummary>;
export type ReservationLogWriter = (entry: ReservationLogEntry) => Promise<void>;
export type PostCallService = (call: PostCallWebhook) => Promise<PostCallResult>;

export type ReservationDeposit = {
  amountLabel: string;
  amountCents?: number;
  currency?: string;
  paymentLinkUrl?: string;
};

let openai: OpenAI | undefined;

function getOpenAI(): OpenAI {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to extract post-call reservation details.");
  }

  openai ??= new OpenAI({
    apiKey: config.OPENAI_API_KEY
  });

  return openai;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSummary(value: unknown): PostCallSummary {
  const item = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const reservation = typeof item.reservation === "object" && item.reservation !== null ? (item.reservation as Record<string, unknown>) : {};

  return {
    shouldSend: item.shouldSend === true,
    conversationContext: asString(item.conversationContext) ?? "The caller discussed a reservation request.",
    reservation: {
      guestName: asString(reservation.guestName),
      partySize: asString(reservation.partySize),
      day: asString(reservation.day),
      time: asString(reservation.time),
      specialNotes: asString(reservation.specialNotes)
    }
  };
}

function parsePartySize(partySize: string | undefined): number | undefined {
  const match = partySize?.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function formatDepositAmount(amountCents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2
  }).format(amountCents / 100);
}

function cleanMessageDetail(value: string | undefined): string | undefined {
  return value?.trim().replace(/[.。]+$/u, "") || undefined;
}

function sanitizeSpecialNotes(notes: string | undefined): string | undefined {
  const cleaned = notes
    ?.split(/[;\n.]+/)
    .map((note) => note.trim())
    .filter((note) => note && !/\b(deposit|payment|stripe|link)\b|\$\d+/i.test(note))
    .join("; ");

  return cleanMessageDetail(cleaned);
}

export function reservationDepositForPartySize(partySize: string | undefined): ReservationDeposit {
  const size = parsePartySize(partySize);
  const isLargeParty = size !== undefined && size > 10;
  const amountCents = isLargeParty
    ? config.STRIPE_LARGE_PARTY_RESERVATION_DEPOSIT_AMOUNT_CENTS
    : config.STRIPE_STANDARD_RESERVATION_DEPOSIT_AMOUNT_CENTS;
  const specificPaymentLinkUrl = isLargeParty
    ? config.STRIPE_LARGE_PARTY_RESERVATION_PAYMENT_LINK_URL
    : config.STRIPE_STANDARD_RESERVATION_PAYMENT_LINK_URL;
  const paymentLinkUrl = specificPaymentLinkUrl ?? config.STRIPE_RESERVATION_PAYMENT_LINK_URL;

  return {
    amountLabel: formatDepositAmount(amountCents, config.STRIPE_RESERVATION_DEPOSIT_CURRENCY),
    amountCents,
    currency: config.STRIPE_RESERVATION_DEPOSIT_CURRENCY.toLowerCase(),
    paymentLinkUrl
  };
}

export function stripeClientReferenceForReservation(reservationId: string): string {
  return reservationId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
}

export function paymentLinkWithReservationReference(paymentLinkUrl: string | undefined, reservationId: string): string | undefined {
  if (!paymentLinkUrl) return undefined;
  try {
    const url = new URL(paymentLinkUrl);
    url.searchParams.set("client_reference_id", stripeClientReferenceForReservation(reservationId));
    return url.toString();
  } catch {
    return paymentLinkUrl;
  }
}

export async function extractPostCallSummary(call: PostCallWebhook): Promise<PostCallSummary> {
  const response = await getOpenAI().responses.create({
    model: config.OPENAI_MODEL,
    instructions: [
      "Extract restaurant reservation details from a completed phone-call transcript.",
      "Return only compact JSON with this shape:",
      '{"shouldSend":boolean,"conversationContext":"string","reservation":{"guestName":"string","partySize":"string","day":"string","time":"string","specialNotes":"string"}}',
      "Set shouldSend true only when the call includes a reservation request or inquiry.",
      "Use empty strings for missing fields. Keep specialNotes brief and include allergies, occasions, seating preferences, accessibility needs, BYOW, cake, and large-party notes."
    ].join("\n"),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              call.callId ? `Call ID: ${call.callId}` : undefined,
              call.caller ? `Caller: ${call.caller}` : undefined,
              "Transcript:",
              call.transcript
            ]
              .filter(Boolean)
              .join("\n")
          }
        ]
      }
    ]
  });

  return normalizeSummary(JSON.parse(response.output_text.trim()));
}

export function formatReservationConfirmationMessage(
  summary: PostCallSummary,
  deposit: ReservationDeposit = reservationDepositForPartySize(summary.reservation.partySize)
): string {
  const { reservation } = summary;
  const specialNotes = sanitizeSpecialNotes(reservation.specialNotes);
  const details = [
    `Party size: ${cleanMessageDetail(reservation.partySize) || "not specified"}`,
    `Day/time: ${[cleanMessageDetail(reservation.day), cleanMessageDetail(reservation.time)].filter(Boolean).join(" at ") || "not specified"}`,
    `Special notes: ${specialNotes || "none"}`
  ];
  const payment = deposit.paymentLinkUrl
    ? ` To complete the reservation deposit, please use this ${deposit.amountLabel} Stripe link: ${deposit.paymentLinkUrl}.`
    : ` The reservation deposit is ${deposit.amountLabel}; the restaurant will send a Stripe payment link separately.`;

  return `Thanks for calling ${config.COMPANY_NAME}. We noted your reservation details: ${details.join("; ")}.${payment}`;
}

export function createPostCallService(
  extractor: PostCallExtractor = extractPostCallSummary,
  sender: PostCallMessageSender = (options) =>
    sendAgentPhoneMessage({
      ...options,
      apiKey: config.AGENTPHONE_API_KEY,
      agentId: config.AGENTPHONE_AGENT_ID,
      baseUrl: config.AGENTPHONE_BASE_URL
    }),
  reservationLogWriter: ReservationLogWriter = defaultReservationRecorder
): PostCallService {
  return async (call) => {
    if (!call.caller || call.caller === "web") {
      return { sent: false, reason: "No caller phone number was present on the post-call webhook." };
    }

    const summary = await extractor(call);
    if (!summary.shouldSend) {
      return { sent: false, reason: "Call did not include a reservation request.", summary };
    }

    const createdAt = new Date().toISOString();
    const baseDeposit = reservationDepositForPartySize(summary.reservation.partySize);
    const entry = createReservationLogEntry({
      callId: call.callId,
      caller: call.caller,
      conversationContext: summary.conversationContext,
      reservation: summary.reservation,
      deposit: baseDeposit,
      createdAt
    });
    const deposit = {
      ...baseDeposit,
      paymentLinkUrl: paymentLinkWithReservationReference(baseDeposit.paymentLinkUrl, entry.id)
    };

    await reservationLogWriter(
      {
        ...entry,
        deposit
      }
    );

    const message = formatReservationConfirmationMessage(summary, deposit);
    await sender({
      toNumber: call.caller,
      numberId: call.numberId,
      body: message
    });

    return { sent: true, message, summary };
  };
}
