import { setSafe } from '../util/storeHelper';

import Icon from './Icon';

import * as _ from 'lodash';
import * as PropTypes from 'prop-types';
import * as React from 'react';
import { Image, Overlay, Popover } from 'react-bootstrap';
import { Portal } from 'react-overlays';

function PopoverImage(props: any) {
  return (
    <Image
      src={props.src}
      className='zoomed-image'
      onClick={props.onClick}
      style={{ top: props.positionTop, left: props.positionLeft }}
    />
  );
}

export interface IZoomableImageProps {
  className: string;
  url: string;
}

class ZoomableImage extends React.Component<IZoomableImageProps, { showOverlay: boolean }> {
  public static contextTypes: React.ValidationMap<any> = {
    menuLayer: PropTypes.object,
  };

  public context: { menuLayer: JSX.Element };

  constructor(props) {
    super(props);
    this.state = {
      showOverlay: false,
    };
  }

  public render(): JSX.Element {
    const { className, url } = this.props;
    const { showOverlay } = this.state;

    return (
      <div className={className}>
        { (url !== undefined)
          ? <Image className='zoomable-image' src={url} onClick={this.toggleOverlay} />
          : <Icon name='image' />
        }
        {showOverlay ? (
          <Portal
            container={this.context.menuLayer}
          >
            <div className='zoom-backdrop' >
              <PopoverImage src={url} onClick={this.toggleOverlay}/>
            </div>
          </Portal>
        ) : null}
        {this.props.children}
      </div>
    );
  }

  private toggleOverlay = () => {
    this.setState(setSafe(this.state, ['showOverlay'], !this.state.showOverlay));
  }
}

export default ZoomableImage;
