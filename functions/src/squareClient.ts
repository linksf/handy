import {SquareClient, SquareEnvironment} from "square";
import {defineSecret, defineString} from "firebase-functions/params";

export const squareAccessToken = defineSecret("SQUARE_ACCESS_TOKEN");
export const squareLocationId = defineSecret("SQUARE_LOCATION_ID");
export const squareWebhookSignatureKey = defineSecret("SQUARE_WEBHOOK_SIGNATURE_KEY");
export const squareEnvironment = defineString("SQUARE_ENVIRONMENT", {default: "sandbox"});

export function getSquareClient(): SquareClient {
  const env = squareEnvironment.value().toLowerCase();
  return new SquareClient({
    token: squareAccessToken.value(),
    environment: env === "production" ?
      SquareEnvironment.Production :
      SquareEnvironment.Sandbox,
  });
}

export function getSquareLocationId(): string {
  return squareLocationId.value();
}
