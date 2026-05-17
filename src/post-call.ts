import OpenAI from "openai";
import { config } from "./config.js";
import {
  sendAgentPhoneMessage,
  type PostCallWebhook,
  type SendAgentPhoneMessageOptions
} from "./agentphone.js";

export type ReservationDetails = {
  guestName?: string;
  partySize?: string;
  day?: string;
  time?: string;
  specialNotes?: string;
};

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
export type PostCallService = (call: PostCallWebhook) => Promise<PostCallResult>;

type ReservationDeposit = {
  amountLabel: string;
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

export function reservationDepositForPartySize(partySize: string | undefined): ReservationDeposit {
  const size = parsePartySize(partySize);
  const isLargeParty = size !== undefined && size > 10;
  const amountCents = isLargeParty
    ? config.STRIPE_LARGE_PARTY_RESERVATION_DEPOSIT_AMOUNT_CENTS
    : config.STRIPE_STANDARD_RESERVATION_DEPOSIT_AMOUNT_CENTS;
  const specificPaymentLinkUrl = isLargeParty
    ? config.STRIPE_LARGE_PARTY_RESERVATION_PAYMENT_LINK_URL
    : config.STRIPE_STANDARD_RESERVATION_PAYMENT_LINK_URL;
  const paymentLinkUrl =
    specificPaymentLinkUrl ??
    (config.STRIPE_RESERVATION_DEPOSIT_AMOUNT_CENTS === amountCents ? config.STRIPE_RESERVATION_PAYMENT_LINK_URL : undefined);

  return {
    amountLabel: formatDepositAmount(amountCents, config.STRIPE_RESERVATION_DEPOSIT_CURRENCY),
    paymentLinkUrl
  };
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
  const details = [
    `Party size: ${reservation.partySize || "not specified"}`,
    `Day/time: ${[reservation.day, reservation.time].filter(Boolean).join(" at ") || "not specified"}`,
    `Special notes: ${reservation.specialNotes || "none"}`
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
    })
): PostCallService {
  return async (call) => {
    if (!call.caller || call.caller === "web") {
      return { sent: false, reason: "No caller phone number was present on the post-call webhook." };
    }

    const summary = await extractor(call);
    if (!summary.shouldSend) {
      return { sent: false, reason: "Call did not include a reservation request.", summary };
    }

    const message = formatReservationConfirmationMessage(summary);
    await sender({
      toNumber: call.caller,
      numberId: call.numberId,
      body: message
    });

    return { sent: true, message, summary };
  };
}
