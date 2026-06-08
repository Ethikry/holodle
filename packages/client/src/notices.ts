import type { HeightBucket } from "@holodle/shared";

// ─── Versioned one-time "patch notes" notices ──────────────────────────
//
// Returning players (those who've already dismissed the welcome overlay)
// are shown the notice once when their server-stored `lastSeenNoticeVersion`
// is below CURRENT_NOTICE_VERSION. Dismissing the overlay bumps their stored
// version to current. Brand-new players never see historical notices: the
// welcome overlay's dismiss handler catches them up to CURRENT_NOTICE_VERSION
// directly (see WelcomeOverlay.tsx).
//
// To ship a new notice: add its content, bump CURRENT_NOTICE_VERSION, and
// have NoticeOverlay render the content for the new version.

export const CURRENT_NOTICE_VERSION = 1;

export interface HeightMove {
  talentId: string;
  from: HeightBucket;
  to: HeightBucket;
}

// Version 1 — height re-sort. Cutoffs changed from
//   ≤150 Smol / 151–160 Med / >160 Tall
// to
//   <150 Smol / 150–165 Med / >165 Tall.
// These 18 movers were computed once from talent_data.json by diffing the
// old vs new buckets; all of them land in Med. Baked in as data so the old
// cutoffs don't have to live on in the codebase.
export const HEIGHT_REBUCKET_MOVERS: HeightMove[] = [
  // 150cm — were Smol, now Med.
  { talentId: "airani-iofifteen", from: "Smol", to: "Med" },
  { talentId: "houshou-marine", from: "Smol", to: "Med" },
  { talentId: "kobo-kanaeru", from: "Smol", to: "Med" },
  { talentId: "mano-aloe", from: "Smol", to: "Med" },
  { talentId: "tokoyami-towa", from: "Smol", to: "Med" },
  { talentId: "watson-amelia", from: "Smol", to: "Med" },
  // 161–165cm — were Tall, now Med.
  { talentId: "kikirara-vivi", from: "Tall", to: "Med" },
  { talentId: "takane-lui", from: "Tall", to: "Med" },
  { talentId: "aki-rosenthal", from: "Tall", to: "Med" },
  { talentId: "cecilia-immergreen", from: "Tall", to: "Med" },
  { talentId: "ichijou-ririka", from: "Tall", to: "Med" },
  { talentId: "irys", from: "Tall", to: "Med" },
  { talentId: "kureiji-ollie", from: "Tall", to: "Med" },
  { talentId: "shiori-novella", from: "Tall", to: "Med" },
  { talentId: "ceres-fauna", from: "Tall", to: "Med" },
  { talentId: "moona-hoshinova", from: "Tall", to: "Med" },
  { talentId: "takanashi-kiara", from: "Tall", to: "Med" },
  { talentId: "yuzuki-choco", from: "Tall", to: "Med" },
];
