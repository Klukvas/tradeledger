-- JavaScript lowercasing can expand a valid 80-character SKU (for example U+0130).
-- Keep the normalized key unbounded so its uniqueness exactly follows the domain.
ALTER TABLE "InventoryItem" ALTER COLUMN "skuKey" TYPE TEXT;
