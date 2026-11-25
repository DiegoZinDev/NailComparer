import { Router } from 'express';
import { HealthController } from '../controllers/HealthController.js';
import { NailDesignController } from '../controllers/NailDesignController.js';
import { StudioConfigController } from '../controllers/StudioConfigController.js';

export function createApiRoutes(): Router {
  const router = Router();

  const healthController = new HealthController();
  const studioConfigController = new StudioConfigController();
  const nailDesignController = new NailDesignController();

  router.get('/health', healthController.check);

  router.get('/config', studioConfigController.getConfig);
  router.put('/config', studioConfigController.updateConfig);

  router.get('/designs', nailDesignController.listDesigns);
  router.get('/designs/:id', nailDesignController.getDesignById);
  router.post('/designs', nailDesignController.createDesign);
  router.patch('/designs/:id', nailDesignController.updateDesign);
  router.delete('/designs/:id', nailDesignController.deleteDesign);

  return router;
}
