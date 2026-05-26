import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

async function main() {
  // Create admin user
  const passwordHash = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      passwordHash,
      displayName: "Admin",
      role: "ADMIN",
    },
  });

  console.log("Created admin user:", admin.username);
  console.log("Password: admin123");
  console.log("(Change this after first login!)");

  // Create a few invite codes
  for (let i = 0; i < 5; i++) {
    const invite = await prisma.inviteCode.create({
      data: { createdBy: admin.id },
    });
    console.log(`Invite code ${i + 1}: ${invite.code}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
