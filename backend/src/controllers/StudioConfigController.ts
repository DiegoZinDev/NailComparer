import type { NextFunction, Request, Response } from 'express';
import { StudioConfigService } from '../services/StudioConfigService.js';

export class StudioConfigController {
  private readonly studioConfigService: StudioConfigService;

  constructor(studioConfigService = new StudioConfigService()) {
    this.studioConfigService = studioConfigService;
  }

  getConfig = (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const config = this.studioConfigService.getConfig();
      res.status(200).json(config);
    } catch (error) {
      next(error);
    }
  };

  updateConfig = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const updated = this.studioConfigService.updateConfig(req.body);
      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  };
}
