import type { FastifyInstance } from 'fastify';
import { ObjectId } from 'mongodb';
import { projects } from '../db.js';
import { requireAuth } from '../auth/requireAuth.js';

interface UpsertBody {
  title?: string;
  json?: unknown;
}

interface FullUpdateBody extends UpsertBody {
  // The `updatedAt` the client last fetched/saved — omitted, the update is
  // unconditional (matches the pre-conflict-detection behavior exactly, so
  // an older client or the offline-queue flush path keeps working
  // unchanged). Sent, the update only applies if the stored document still
  // has exactly this timestamp — i.e. nobody else has saved since this
  // client last knew about the project — so two tabs/devices editing the
  // same project can't silently overwrite each other without at least one
  // of them finding out.
  expectedUpdatedAt?: string;
}

export default async function projectRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // List — metadata only (no `json` blob), matches the dashboard grid's
  // needs (thumbnail, title, relative time) without shipping every
  // project's full, potentially multi-MB payload just to render cards.
  app.get('/api/projects', async (req) => {
    const docs = await projects()
      .find({ ownerId: req.userId }, { projection: { json: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
    return docs.map((d) => ({
      id: d._id,
      title: d.title,
      thumbnail: d.thumbnail,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));
  });

  // A single 404 for "doesn't exist" and "exists but isn't yours" — the
  // ownerId filter means a wrong-owner id simply never matches, so this
  // never distinguishes the two cases to the caller.
  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const doc = await projects().findOne({ _id: req.params.id, ownerId: req.userId });
    if (!doc) return reply.code(404).send({ error: 'Présentation introuvable.' });
    return { id: doc._id, title: doc.title, json: doc.json, thumbnail: doc.thumbnail, updatedAt: doc.updatedAt };
  });

  app.post<{ Body: UpsertBody }>('/api/projects', async (req, reply) => {
    const title = (req.body?.title || 'Sans titre').slice(0, 300);
    const json = req.body?.json;
    if (json === undefined) return reply.code(400).send({ error: 'Champ "json" manquant.' });

    const now = new Date();
    const doc = {
      _id: new ObjectId().toHexString(),
      ownerId: req.userId as ObjectId,
      title,
      json,
      thumbnail: null,
      createdAt: now,
      updatedAt: now,
    };
    await projects().insertOne(doc);
    reply.code(201);
    return { id: doc._id, title: doc.title, thumbnail: doc.thumbnail, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
  });

  // Full update (title + content) — requires an existing, owned project;
  // unlike the milestone this replaced, this does NOT upsert an arbitrary
  // client-supplied id, since POST above is now the one creation path and
  // always returns a server-generated id.
  app.put<{ Params: { id: string }; Body: FullUpdateBody }>('/api/projects/:id', async (req, reply) => {
    const title = (req.body?.title || 'Sans titre').slice(0, 300);
    const json = req.body?.json;
    if (json === undefined) return reply.code(400).send({ error: 'Champ "json" manquant.' });

    const filter: Record<string, unknown> = { _id: req.params.id, ownerId: req.userId };
    const expectedUpdatedAt = req.body?.expectedUpdatedAt ? new Date(req.body.expectedUpdatedAt) : null;
    if (expectedUpdatedAt && !Number.isNaN(expectedUpdatedAt.getTime())) {
      filter.updatedAt = expectedUpdatedAt;
    }

    const updatedAt = new Date();
    const result = await projects().updateOne(filter, { $set: { title, json, updatedAt } });
    if (result.matchedCount === 0) {
      // Only a real conflict (project exists, just with a *different*
      // updatedAt than expected) if the client actually sent one to check
      // against — otherwise this is the plain "doesn't exist / isn't
      // yours" case the ownerId-scoped filter always produced.
      if (filter.updatedAt) {
        const current = await projects().findOne({ _id: req.params.id, ownerId: req.userId }, { projection: { updatedAt: 1 } });
        if (current) {
          return reply.code(409).send({
            error: 'Ce projet a été modifié ailleurs entre-temps.',
            updatedAt: current.updatedAt,
          });
        }
      }
      return reply.code(404).send({ error: 'Présentation introuvable.' });
    }
    return { ok: true, updatedAt };
  });

  // Title-only rename — the dashboard's inline-rename card action shouldn't
  // have to round-trip a multi-MB `json` blob just to change a label.
  app.patch<{ Params: { id: string }; Body: { title?: string } }>('/api/projects/:id', async (req, reply) => {
    const title = (req.body?.title || '').trim().slice(0, 300);
    if (!title) return reply.code(400).send({ error: 'Titre invalide.' });
    const result = await projects().updateOne(
      { _id: req.params.id, ownerId: req.userId },
      { $set: { title, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) return reply.code(404).send({ error: 'Présentation introuvable.' });
    return { ok: true };
  });

  // Thumbnail refresh, separate from the main PUT so an autosave tick can
  // update either independently. Deliberately does NOT bump `updatedAt` —
  // that reflects real content edits (used for "last edited" + sort), and a
  // thumbnail re-render triggered by the same debounce tick as a content
  // save already gets a fresh updatedAt from that PUT.
  app.put<{ Params: { id: string }; Body: { thumbnail?: string | null } }>(
    '/api/projects/:id/thumbnail',
    async (req, reply) => {
      const result = await projects().updateOne(
        { _id: req.params.id, ownerId: req.userId },
        { $set: { thumbnail: req.body?.thumbnail ?? null } }
      );
      if (result.matchedCount === 0) return reply.code(404).send({ error: 'Présentation introuvable.' });
      return { ok: true };
    }
  );

  // Server-side copy — avoids round-tripping a potentially large `json`
  // blob back out to the client and back in just to duplicate a project.
  app.post<{ Params: { id: string } }>('/api/projects/:id/duplicate', async (req, reply) => {
    const original = await projects().findOne({ _id: req.params.id, ownerId: req.userId });
    if (!original) return reply.code(404).send({ error: 'Présentation introuvable.' });
    const now = new Date();
    const copy = {
      _id: new ObjectId().toHexString(),
      ownerId: req.userId as ObjectId,
      title: `${original.title} (copie)`,
      json: original.json,
      thumbnail: original.thumbnail,
      createdAt: now,
      updatedAt: now,
    };
    await projects().insertOne(copy);
    reply.code(201);
    return { id: copy._id, title: copy.title, thumbnail: copy.thumbnail, createdAt: copy.createdAt, updatedAt: copy.updatedAt };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const result = await projects().deleteOne({ _id: req.params.id, ownerId: req.userId });
    if (result.deletedCount === 0) return reply.code(404).send({ error: 'Présentation introuvable.' });
    return { ok: true };
  });
}
