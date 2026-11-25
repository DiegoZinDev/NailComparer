import type { NextFunction, Request, Response } from 'express';
import { NailDesignService } from '../services/NailDesignService.js';

export class NailDesignController {
  private readonly nailDesignService: NailDesignService;

  constructor(nailDesignService = new NailDesignService()) {
    this.nailDesignService = nailDesignService;
  }

  listDesigns = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const category =
        typeof req.query.category === 'string' ? req.query.category : undefined;
      const designs = this.nailDesignService.listDesigns(category);
      res.status(200).json(designs);
    } catch (error) {
      next(error);
    }
  };

  getDesignById = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = String(req.params.id ?? '');
      const design = this.nailDesignService.getDesignById(id);
      res.status(200).json(design);
    } catch (error) {
      next(error);
    }
  };

  createDesign = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const created = this.nailDesignService.createDesign(req.body);
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  };

  updateDesign = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = String(req.params.id ?? '');
      const updated = this.nailDesignService.updateDesign(id, req.body);
      res.status(200).json(updated);
    } catch (error) {
      next(error);
    }
  };

  deleteDesign = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const id = String(req.params.id ?? '');
      const result = this.nailDesignService.deleteDesign(id);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}
