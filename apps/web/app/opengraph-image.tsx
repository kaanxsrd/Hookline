import { socialImage, socialImageAlt, socialImageSize } from "@/components/marketing/social-image";

export const alt = socialImageAlt;
export const size = socialImageSize;
export const contentType = "image/png";

export default function OpengraphImage() {
  return socialImage();
}
