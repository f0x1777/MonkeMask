-- Monke asset catalog. Instead of uploading a photo of a monke, an ambassador can pull
-- it by collection + number (Gen2 = Solana Monkey Business, Gen3 = SMB Gen3). The team
-- ingests the full asset library here (number -> image), so monkes come from the
-- canonical high-quality art, not a low-res cutout. Not secret data (it's public NFT
-- art), but written/read via the service role with a role check.
create table if not exists public.monke_assets (
  generation text not null check (generation in ('gen2', 'gen3')),
  number int not null,
  image_url text not null,        -- https URL to the asset art (Supabase Storage / Arweave / etc.)
  traits jsonb,                   -- optional metadata for future filtering
  added_by text,
  created_at timestamptz not null default now(),
  primary key (generation, number)
);
alter table public.monke_assets enable row level security;
grant select, insert, update, delete on public.monke_assets to service_role;
