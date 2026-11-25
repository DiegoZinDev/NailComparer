import { Router } from 'express';
import { HealthController } from '../controllers/HealthController.js';
import { NailDesignController } from '../controllers/NailDesignController.js';
import { StudioConfigController } from '../controllers/StudioConfigController.js';
import { VisionController } from '../controllers/VisionController.js';

export function createApiRoutes(): Router {
  const router = Router();

  const healthController = new HealthController();
  const studioConfigController = new StudioConfigController();
  const nailDesignController = new NailDesignController();
  const visionController = new VisionController();

  router.get('/health', healthController.check);

  router.get('/config', studioConfigController.getConfig);
  router.put('/config', studioConfigController.updateConfig);

  router.get('/designs', nailDesignController.listDesigns);
  router.get('/designs/:id', nailDesignController.getDesignById);
  router.post('/designs', nailDesignController.createDesign);
  router.patch('/designs/:id', nailDesignController.updateDesign);
  router.delete('/designs/:id', nailDesignController.deleteDesign);

  router.post('/vision/reconstruct-reference', visionController.reconstructReference);

  return router;
}
